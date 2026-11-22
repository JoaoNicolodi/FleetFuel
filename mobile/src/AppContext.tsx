import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { getSetting, listCachedVehicles, listQueue, saveVehiclesCache, setSetting, SqliteQueueStore, type CachedVehicle } from './db/database';
import { endSession, fetchVehicles, HttpRefuelApi, sendTelemetry, startSession } from './services/api';
import { filePhotoReader, haptic, watchPosition } from './services/device';
import { SyncEngine } from './sync/sync-engine';
import type { PendingRefuel, SyncSummary } from './sync/types';

interface Shift {
  token: string;
  vehicleId: string;
  plate: string;
  driverName: string;
  expiresAt: string;
}

interface AppCtx {
  ready: boolean;
  online: boolean;
  syncing: boolean;
  lastSync: SyncSummary | null;
  queue: PendingRefuel[];
  vehicles: CachedVehicle[];
  driverName: string;
  vehicleId: string | null;
  shift: Shift | null;
  setDriverName(name: string): Promise<void>;
  selectVehicle(id: string): Promise<void>;
  refreshVehicles(): Promise<string | null>;
  startShift(name?: string): Promise<string | null>;
  endShift(): Promise<void>;
  syncNow(): Promise<void>;
  reloadQueue(): Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp fora do AppProvider');
  return c;
};

const engine = new SyncEngine(new SqliteQueueStore(), new HttpRefuelApi(), filePhotoReader);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncSummary | null>(null);
  const [queue, setQueue] = useState<PendingRefuel[]>([]);
  const [vehicles, setVehicles] = useState<CachedVehicle[]>([]);
  const [driverName, setDriver] = useState('');
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);
  const onlineRef = useRef(false);

  const reloadQueue = useCallback(async () => setQueue(await listQueue()), []);

  const refreshVehicles = useCallback(async () => {
    try {
      const remote = await fetchVehicles();
      await saveVehiclesCache(
        remote.map((v) => ({
          id: v.id,
          plate: v.plate,
          model: v.model,
          department: v.department,
          lastOdometerKm: v.lastOdometerKm,
          limitLiters: v.quota?.limitLiters ?? null,
          remainingLiters: v.quota?.remainingLiters ?? null,
        })),
      );
      setVehicles(await listCachedVehicles());
      return null;
    } catch {
      setVehicles(await listCachedVehicles()); // sem rede: continua com o cache
      return 'Sem conexão: usando a lista salva no aparelho';
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (!onlineRef.current) return;
    setSyncing(true);
    try {
      const summary = await engine.run();
      if (!summary.skipped) {
        setLastSync(summary);
        if (summary.synced > 0) haptic.success();
        if (summary.rejected > 0) haptic.error();
        if (summary.synced + summary.rejected > 0) await refreshVehicles();
      }
    } finally {
      setSyncing(false);
      await reloadQueue();
    }
  }, [refreshVehicles, reloadQueue]);

  // Carga inicial a partir do SQLite (funciona 100% offline).
  useEffect(() => {
    (async () => {
      setDriver((await getSetting('driverName')) ?? '');
      setVehicleId(await getSetting('vehicleId'));
      const s = await getSetting('shift');
      if (s) {
        const parsed = JSON.parse(s) as Shift;
        if (new Date(parsed.expiresAt).getTime() > Date.now()) setShift(parsed);
      }
      setVehicles(await listCachedVehicles());
      await reloadQueue();
      setReady(true);
    })();
  }, [reloadQueue]);

  // Gatilho 1: conectividade voltou → sincroniza.
  useEffect(() => {
    return NetInfo.addEventListener((state) => {
      const isOnline = Boolean(state.isConnected) && state.isInternetReachable !== false;
      const cameBack = isOnline && !onlineRef.current;
      onlineRef.current = isOnline;
      setOnline(isOnline);
      if (cameBack) void syncNow();
    });
  }, [syncNow]);

  // Gatilho 2: app voltou para primeiro plano. Gatilho 3: timer a cada 30 s (respeita o backoff de cada item).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => st === 'active' && void syncNow());
    const timer = setInterval(() => void syncNow(), 30_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [syncNow]);

  // Telemetria: enquanto houver turno e rede, envia a posição ao Serviço B.
  useEffect(() => {
    if (!shift) return;
    let cancelled = false;
    let sub: { remove(): void } | null = null;
    watchPosition(async (p) => {
      if (!onlineRef.current || cancelled) return;
      const valid = await sendTelemetry(shift.token, { ...p, recordedAt: new Date().toISOString() }).catch(() => true);
      if (!valid) {
        setShift(null);
        await setSetting('shift', null);
      }
    }).then((s) => {
      if (cancelled) s?.remove();
      else sub = s;
    });
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [shift]);

  const value = useMemo<AppCtx>(
    () => ({
      ready, online, syncing, lastSync, queue, vehicles, driverName, vehicleId, shift,
      async setDriverName(name) {
        setDriver(name);
        await setSetting('driverName', name);
      },
      async selectVehicle(id) {
        setVehicleId(id);
        await setSetting('vehicleId', id);
      },
      refreshVehicles,
      async startShift(name) {
        const v = vehicles.find((x) => x.id === vehicleId);
        const driver = (name ?? driverName).trim();
        if (!v || !driver) return 'Informe o motorista e escolha o veículo';
        try {
          const s = await startSession({ vehicleId: v.id, plate: v.plate, driverName: driver });
          const sh = { token: s.token, expiresAt: s.expiresAt, vehicleId: v.id, plate: v.plate, driverName: driver };
          setShift(sh);
          await setSetting('shift', JSON.stringify(sh));
          haptic.success();
          return null;
        } catch (e) {
          return (e as Error).message || 'Não foi possível iniciar o turno';
        }
      },
      async endShift() {
        if (shift) await endSession(shift.token);
        setShift(null);
        await setSetting('shift', null);
      },
      syncNow,
      reloadQueue,
    }),
    [ready, online, syncing, lastSync, queue, vehicles, driverName, vehicleId, shift, refreshVehicles, syncNow, reloadQueue],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
