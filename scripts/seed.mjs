#!/usr/bin/env node
/**
 * Popula o ambiente com dados de demonstração (veículos + cotas do mês).
 *   node scripts/seed.mjs
 */
const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080';
const month = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);

const fleet = [
  { plate: 'IXA1B23', model: 'Fiat Strada', department: 'Secretaria de Saúde', fuelType: 'GASOLINA', expectedKmPerLiter: 11, initialOdometerKm: 48_210, quota: 250 },
  { plate: 'IXB4C56', model: 'VW Gol', department: 'Secretaria de Educação', fuelType: 'ETANOL', expectedKmPerLiter: 8, initialOdometerKm: 91_002, quota: 180 },
  { plate: 'IXC7D89', model: 'Mercedes Sprinter (ambulância)', department: 'Secretaria de Saúde', fuelType: 'DIESEL', expectedKmPerLiter: 7, initialOdometerKm: 150_330, quota: 400 },
  { plate: 'IXD2E34', model: 'Volvo VM (caminhão)', department: 'Secretaria de Obras', fuelType: 'DIESEL', expectedKmPerLiter: 3.5, initialOdometerKm: 220_450, quota: 900 },
  { plate: 'IXE5F67', model: 'Toyota Hilux', department: 'Secretaria de Agricultura', fuelType: 'DIESEL', expectedKmPerLiter: 9, initialOdometerKm: 33_870, quota: 300 },
];

const post = async (path, method, body) => {
  const res = await fetch(`${GATEWAY}/api/core${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

for (const { quota, ...v } of fleet) {
  let r = await post('/vehicles', 'POST', v);
  if (r.status === 409) {
    const list = await (await fetch(`${GATEWAY}/api/core/vehicles`)).json();
    r = { status: 200, body: list.find((x) => x.plate === v.plate) };
  }
  if (!r.body?.id) {
    console.log(`✗ ${v.plate}: ${JSON.stringify(r.body)}`);
    continue;
  }
  const q = await post(`/vehicles/${r.body.id}/quotas/${month}`, 'PUT', { limitLiters: quota });
  console.log(`✓ ${v.plate} (${v.model}) — cota ${quota} L em ${month} [${q.status}]`);
}
console.log(`\nAbra o painel: ${GATEWAY}`);
