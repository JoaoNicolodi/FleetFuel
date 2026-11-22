import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSut, refuelInput, seedVehicleWithQuota } from './support/fixtures';

describe('RegisterRefuelUseCase (com repositórios em memória)', () => {
  test('aceita abastecimento válido, debita a cota e grava evento no outbox', async () => {
    const sut = buildSut();
    const v = await seedVehicleWithQuota(sut, 100);

    const r = await sut.registerRefuel.execute(refuelInput(v.id));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.refuel.status, 'ACCEPTED');
    assert.equal(r.value.refuel.kmPerLiter, 10);
    assert.equal(r.value.refuel.totalCents, 25160); // 40 L × R$ 6,29
    assert.equal(r.value.refuel.quotaRemainingLiters, 60);

    const bal = await sut.balance.execute(v.id, '2026-11');
    assert.ok(bal.ok);
    if (bal.ok) {
      assert.equal(bal.value.quota?.usedLiters, 40);
      assert.equal(bal.value.lastOdometerKm, 10_400);
    }
    assert.ok(sut.db.outbox.some((e) => e.type === 'refuel.registered'));
    assert.equal(sut.photos.files.size, 1);
  });

  test('é idempotente: reenviar o mesmo clientId (sync offline) não debita de novo', async () => {
    const sut = buildSut();
    const v = await seedVehicleWithQuota(sut, 100);
    const input = refuelInput(v.id, { offline: true });

    const first = await sut.registerRefuel.execute(input);
    const second = await sut.registerRefuel.execute(input);
    const third = await sut.registerRefuel.execute(input);

    assert.ok(first.ok && second.ok && third.ok);
    if (first.ok && second.ok) {
      assert.equal(first.value.replayed, false);
      assert.equal(second.value.replayed, true);
      assert.equal(second.value.refuel.id, first.value.refuel.id);
    }
    assert.equal(sut.db.refuels.size, 1);
    const bal = await sut.balance.execute(v.id, '2026-11');
    if (bal.ok) assert.equal(bal.value.quota?.usedLiters, 40);
    assert.equal(sut.db.outbox.filter((e) => e.type === 'refuel.registered').length, 1);
  });

  test('cota estourada: retorna REFUEL_REJECTED, NÃO debita, mas registra para auditoria', async () => {
    const sut = buildSut();
    const v = await seedVehicleWithQuota(sut, 30);

    const r = await sut.registerRefuel.execute(refuelInput(v.id)); // 40 L > 30 L
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error.code, 'REFUEL_REJECTED');
    if (r.error.code === 'REFUEL_REJECTED') {
      assert.equal(r.error.reasonCode, 'QUOTA_EXCEEDED');
      assert.equal(r.error.refuel.status, 'REJECTED');
    }
    const bal = await sut.balance.execute(v.id, '2026-11');
    if (bal.ok) {
      assert.equal(bal.value.quota?.usedLiters, 0);
      assert.equal(bal.value.lastOdometerKm, 10_000); // hodômetro NÃO avançou
    }
    assert.equal(sut.db.refuels.size, 1);
    assert.ok(sut.db.outbox.some((e) => e.type === 'refuel.rejected'));
  });

  test('reenvio de um abastecimento rejeitado devolve a MESMA rejeição (idempotente)', async () => {
    const sut = buildSut();
    const v = await seedVehicleWithQuota(sut, 30);
    const input = refuelInput(v.id);
    await sut.registerRefuel.execute(input);
    const again = await sut.registerRefuel.execute(input);
    assert.equal(again.ok, false);
    if (!again.ok && again.error.code === 'REFUEL_REJECTED') assert.equal(again.error.replayed, true);
    assert.equal(sut.db.refuels.size, 1);
  });

  test('hodômetro que regride é rejeitado', async () => {
    const sut = buildSut();
    const v = await seedVehicleWithQuota(sut, 100);
    const r = await sut.registerRefuel.execute(refuelInput(v.id, { odometerKm: 9_000 }));
    assert.ok(!r.ok && r.error.code === 'REFUEL_REJECTED' && r.error.reasonCode === 'ODOMETER_REGRESSION');
  });

  test('sem cota definida para o mês é rejeitado', async () => {
    const sut = buildSut();
    const v = await seedVehicleWithQuota(sut, 100);
    const r = await sut.registerRefuel.execute(refuelInput(v.id, { occurredAt: '2026-10-30T12:00:00Z' }));
    assert.ok(!r.ok && r.error.code === 'REFUEL_REJECTED' && r.error.reasonCode === 'QUOTA_NOT_DEFINED');
  });

  test('consumo fora do padrão é aceito como FLAGGED (gestor revisa a foto)', async () => {
    const sut = buildSut();
    const v = await seedVehicleWithQuota(sut, 100);
    const r = await sut.registerRefuel.execute(refuelInput(v.id, { odometerKm: 10_050 })); // 50 km / 40 L
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.value.refuel.status, 'FLAGGED');
      assert.match(r.value.refuel.reviewReason ?? '', /abaixo do mínimo/);
    }
  });

  test('sem foto do hodômetro: erro de validação e NADA é persistido', async () => {
    const sut = buildSut();
    const v = await seedVehicleWithQuota(sut, 100);
    const r = await sut.registerRefuel.execute(refuelInput(v.id, { photoBase64: '' }));
    assert.ok(!r.ok && r.error.code === 'VALIDATION_ERROR');
    assert.equal(sut.db.refuels.size, 0);
  });

  test('veículo inexistente retorna NOT_FOUND', async () => {
    const sut = buildSut();
    const r = await sut.registerRefuel.execute(refuelInput('00000000-0000-0000-0000-000000000000'));
    assert.ok(!r.ok && r.error.code === 'NOT_FOUND');
  });
});

describe('SetMonthlyQuotaUseCase', () => {
  test('não deixa reduzir a cota abaixo do consumido', async () => {
    const sut = buildSut();
    const v = await seedVehicleWithQuota(sut, 100);
    await sut.registerRefuel.execute(refuelInput(v.id)); // usa 40 L
    const r = await sut.setQuota.execute({ vehicleId: v.id, month: '2026-11', limitLiters: 20 });
    assert.ok(!r.ok && r.error.code === 'QUOTA_BELOW_USAGE');
  });

  test('placa duplicada retorna CONFLICT', async () => {
    const sut = buildSut();
    await seedVehicleWithQuota(sut);
    const r = await sut.registerVehicle.execute({
      plate: 'ixa-1b23',
      model: 'Outro',
      department: 'Obras',
      fuelType: 'DIESEL',
      expectedKmPerLiter: 5,
    });
    assert.ok(!r.ok && r.error.code === 'CONFLICT');
  });
});
