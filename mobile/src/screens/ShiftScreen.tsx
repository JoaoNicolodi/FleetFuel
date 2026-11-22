import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useApp } from '../AppContext';
import { getSetting, setSetting } from '../db/database';
import { DEFAULT_SERVER } from '../services/api';
import { Button, Card, colors, Field, s } from '../components/ui';

export function ShiftScreen() {
  const app = useApp();
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [name, setName] = useState(app.driverName);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSetting('serverUrl').then((v) => v && setServer(v));
  }, []);
  useEffect(() => setName(app.driverName), [app.driverName]);

  const refresh = async () => {
    setBusy(true);
    await setSetting('serverUrl', server.trim());
    setMsg((await app.refreshVehicles()) ?? 'Lista de veículos atualizada');
    setBusy(false);
  };

  const start = async () => {
    setBusy(true);
    await app.setDriverName(name.trim());
    setMsg((await app.startShift(name.trim())) ?? 'Turno iniciado — sua posição aparece no painel da gestão');
    setBusy(false);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Card title="Servidor">
        <Field label="Endereço do gateway" value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" />
        <Button title="Atualizar veículos" variant="ghost" onPress={refresh} loading={busy} />
      </Card>

      <Card title="Motorista e veículo">
        <Field label="Seu nome" value={name} onChangeText={setName} onBlur={() => app.setDriverName(name.trim())} />
        <Text style={s.label}>Veículo</Text>
        {app.vehicles.length === 0 ? (
          <Text style={s.muted}>Nenhum veículo salvo. Conecte-se e toque em "Atualizar veículos".</Text>
        ) : (
          app.vehicles.map((v) => {
            const selected = v.id === app.vehicleId;
            return (
              <Pressable
                key={v.id}
                onPress={() => app.selectVehicle(v.id)}
                style={{ padding: 12, borderRadius: 8, borderWidth: 2, marginBottom: 8, borderColor: selected ? colors.brand : colors.line, backgroundColor: selected ? colors.brandSoft : '#fff' }}
              >
                <Text style={{ fontWeight: '700' }}>{v.plate} · {v.model}</Text>
                <Text style={s.muted}>
                  {v.department} · saldo {v.remainingLiters === null ? 'sem cota' : `${v.remainingLiters.toFixed(1)} L`}
                </Text>
              </Pressable>
            );
          })
        )}
      </Card>

      <Card title="Turno">
        {app.shift ? (
          <View>
            <Text style={{ color: colors.ok, fontWeight: '700' }}>🟢 Em turno: {app.shift.plate} · {app.shift.driverName}</Text>
            <Text style={s.muted}>Expira em {new Date(app.shift.expiresAt).toLocaleString('pt-BR')}</Text>
            <Button title="Encerrar turno" variant="danger" onPress={app.endShift} />
          </View>
        ) : (
          <View>
            <Text style={s.muted}>O turno envia sua localização ao painel. Abastecimentos podem ser lançados mesmo sem turno e sem sinal.</Text>
            <Button title="Iniciar turno" onPress={start} disabled={!app.online || !app.vehicleId || !name.trim()} loading={busy} />
          </View>
        )}
      </Card>
      {msg ? <Text style={[s.muted, { textAlign: 'center' }]}>{msg}</Text> : null}
    </ScrollView>
  );
}
