#!/usr/bin/env node
/**
 * DEMO PARA A ARGUIÇÃO — teste de carga concorrente contra o sistema rodando (docker compose up).
 *
 *   node scripts/concurrency-attack.mjs                 # 50 requisições simultâneas
 *   node scripts/concurrency-attack.mjs 60              # até ~90 (acima disso o rate limit do gateway devolve 429)
 *   GATEWAY=http://192.168.0.10:8080 node scripts/concurrency-attack.mjs
 *
 * Cenário 1: cota de 100 L, N abastecimentos de 5 L disparados AO MESMO TEMPO.
 *            Esperado: exatamente 20 aceitos, o resto rejeitado, saldo final = 0 (nunca negativo).
 * Cenário 2: o MESMO abastecimento (mesmo clientId) reenviado 10x em paralelo
 *            (simula o app reenviando após perder a resposta). Esperado: 1 criado, 9 replays, 1 débito.
 */
import { randomUUID } from 'node:crypto';

const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080';
const N = Number(process.argv[2] ?? 50);
const API = `${GATEWAY}/api/core`;
const PHOTO = Buffer.alloc(300, 1).toString('base64');
const month = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const randomPlate = () => {
  const L = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const D = () => Math.floor(Math.random() * 10);
  return `${L()}${L()}${L()}${D()}${L()}${D()}${D()}`;
};

const refuel = (vehicleId, clientId = randomUUID()) => ({
  clientId,
  vehicleId,
  driverName: 'Teste de Carga',
  stationName: 'Posto Benchmark',
  liters: 5,
  odometerKm: 20_000,
  pricePerLiterCents: 600,
  occurredAt: new Date().toISOString(),
  offline: false,
  photoBase64: PHOTO,
  photoMimeType: 'image/jpeg',
});

async function main() {
  console.log(`Gateway: ${GATEWAY}\n`);
  const v = await call('POST', '/vehicles', { plate: randomPlate(), model: 'Benchmark', department: 'TI', fuelType: 'DIESEL', expectedKmPerLiter: 10, initialOdometerKm: 20_000 });
  if (v.status !== 201) throw new Error(`Falha ao criar veículo: ${JSON.stringify(v.body)}`);
  const vehicleId = v.body.id;
  await call('PUT', `/vehicles/${vehicleId}/quotas/${month}`, { limitLiters: 100 });
  console.log(`Veículo ${v.body.plate} criado com cota de 100 L em ${month}`);

  // ---------- Cenário 1 ----------
  console.log(`\n▶ Cenário 1: ${N} abastecimentos de 5 L disparados simultaneamente...`);
  const t0 = performance.now();
  const results = await Promise.all(Array.from({ length: N }, () => call('POST', '/refuels', refuel(vehicleId))));
  const ms = Math.round(performance.now() - t0);
  const byStatus = results.reduce((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
  const accepted = results.filter((r) => r.status === 201).length;
  const bal = await call('GET', `/vehicles/${vehicleId}/balance?month=${month}`);
  console.log(`  respostas HTTP: ${JSON.stringify(byStatus)} em ${ms} ms`);
  console.log(`  aceitos: ${accepted} × 5 L = ${accepted * 5} L`);
  console.log(`  saldo no banco: usado ${bal.body.quota.usedLiters} L / limite ${bal.body.quota.limitLiters} L / restante ${bal.body.quota.remainingLiters} L`);
  const ok1 = accepted === Math.min(20, N) && bal.body.quota.usedLiters === accepted * 5 && bal.body.quota.remainingLiters >= 0;
  console.log(ok1 ? '  ✅ Sem race condition: nenhum litro a mais, saldo consistente' : '  ❌ INCONSISTÊNCIA DETECTADA');

  // ---------- Cenário 2 ----------
  console.log('\n▶ Cenário 2: mesmo clientId reenviado 10x em paralelo (idempotência)...');
  await call('PUT', `/vehicles/${vehicleId}/quotas/${month}`, { limitLiters: 200 });
  const before = (await call('GET', `/vehicles/${vehicleId}/balance?month=${month}`)).body.quota.usedLiters;
  const same = refuel(vehicleId);
  const dup = await Promise.all(Array.from({ length: 10 }, () => call('POST', '/refuels', same, { 'idempotency-key': same.clientId })));
  const after = (await call('GET', `/vehicles/${vehicleId}/balance?month=${month}`)).body.quota.usedLiters;
  const created = dup.filter((r) => r.status === 201).length;
  const replays = dup.filter((r) => r.status === 200).length;
  const ids = new Set(dup.map((r) => r.body?.refuel?.id));
  console.log(`  201 criado: ${created} | 200 replay: ${replays} | IDs distintos: ${ids.size} | débito: ${after - before} L`);
  const ok2 = created === 1 && replays === 9 && ids.size === 1 && after - before === 5;
  console.log(ok2 ? '  ✅ Idempotente: um único registro e um único débito' : '  ❌ DUPLICIDADE DETECTADA');

  process.exit(ok1 && ok2 ? 0 : 1);
}

main().catch((e) => {
  console.error('Erro:', e.message, '\nO docker compose está rodando? (docker compose up --build)');
  process.exit(1);
});
