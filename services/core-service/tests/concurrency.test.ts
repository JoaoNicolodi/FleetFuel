import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSut, refuelInput, seedVehicleWithQuota } from './support/fixtures';

/**
 * Cenário de alta concorrência: cota de 100 L e 30 abastecimentos de 5 L
 * disparados AO MESMO TEMPO (Promise.all). Só 20 podem passar.
 */
async function fire(serialize: boolean) {
  const sut = buildSut({ serialize });
  const v = await seedVehicleWithQuota(sut, 100);
  const results = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      sut.registerRefuel.execute(refuelInput(v.id, { liters: 5, odometerKm: 10_000 + (i + 1) * 50 })),
    ),
  );
  const accepted = results.filter((r) => r.ok).length;
  const bal = await sut.balance.execute(v.id, '2026-11');
  const used = bal.ok ? bal.value.quota!.usedLiters : NaN;
  return { accepted, used, results };
}

describe('Concorrência na cota mensal', () => {
  test('COM lock (serialização da transação): exatamente 20 aceitos e saldo fecha em 100 L', async () => {
    const { accepted, used, results } = await fire(true);
    assert.equal(accepted, 20);
    assert.equal(used, 100);
    const rejected = results.filter((r) => !r.ok && r.error.code === 'REFUEL_REJECTED');
    assert.equal(rejected.length, 10);
  });

  test('SEM lock: demonstra a race condition (lost update) — aceita mais do que a cota permite', async () => {
    const { accepted, used } = await fire(false);
    // Todos leem used=0 ao mesmo tempo e "aprovam"; o saldo gravado não bate com o aceito.
    assert.ok(accepted * 5 > 100, `esperava overselling, aceitos=${accepted}`);
    assert.ok(used < accepted * 5, 'saldo gravado perdeu atualizações');
  });
});
