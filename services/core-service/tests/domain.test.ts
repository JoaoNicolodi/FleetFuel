import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Plate } from '../src/core/domain/value-objects/plate';
import { Liters } from '../src/core/domain/value-objects/liters';
import { CompetenceMonth } from '../src/core/domain/value-objects/competence-month';
import { Odometer } from '../src/core/domain/value-objects/odometer';
import { MonthlyQuota } from '../src/core/domain/entities/monthly-quota';
import { Vehicle } from '../src/core/domain/entities/vehicle';

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error('esperava sucesso');
  return r.value;
};

describe('Value Objects', () => {
  test('Plate aceita padrão antigo e Mercosul e normaliza', () => {
    assert.equal(unwrap(Plate.create('abc-1234')).value, 'ABC1234');
    const mercosul = unwrap(Plate.create('IXA1B23'));
    assert.equal(mercosul.isMercosul, true);
  });

  test('Plate rejeita formato inválido retornando Result (sem throw)', () => {
    const r = Plate.create('12ABC34');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, 'VALIDATION_ERROR');
  });

  test('Liters usa mililitros inteiros: 0.1 + 0.2 = 0.3 exato', () => {
    const a = unwrap(Liters.create(0.1));
    const b = unwrap(Liters.create(0.2));
    assert.equal(a.add(b).value, 0.3);
  });

  test('Liters rejeita zero, negativo e acima de 1000 L por abastecimento', () => {
    assert.equal(Liters.create(0).ok, false);
    assert.equal(Liters.create(-5).ok, false);
    assert.equal(Liters.forRefuel(1500).ok, false);
  });

  test('CompetenceMonth usa fuso de Brasília (31/10 22h local ainda é outubro)', () => {
    // 2026-11-01T01:00Z == 2026-10-31T22:00 em UTC-3
    assert.equal(CompetenceMonth.fromDate(new Date('2026-11-01T01:00:00Z')).value, '2026-10');
    assert.equal(CompetenceMonth.create('2026-13').ok, false);
  });

  test('Odometer exige inteiro não negativo', () => {
    assert.equal(Odometer.create(10.5).ok, false);
    assert.equal(Odometer.create(-1).ok, false);
    assert.equal(Odometer.create(1000).ok, true);
  });
});

describe('MonthlyQuota (invariante used <= limit)', () => {
  const quota = () =>
    MonthlyQuota.create({
      id: 'q1',
      vehicleId: 'v1',
      month: CompetenceMonth.restore('2026-11'),
      limit: unwrap(Liters.create(100)),
    });

  test('debita e devolve o saldo restante', () => {
    const q = quota();
    const r = q.debit(unwrap(Liters.create(30)));
    assert.equal(unwrap(r).value, 70);
    assert.equal(q.used.value, 30);
  });

  test('recusa débito acima do saldo sem alterar o estado', () => {
    const q = quota();
    q.debit(unwrap(Liters.create(90)));
    const r = q.debit(unwrap(Liters.create(20)));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.code, 'QUOTA_EXCEEDED');
      assert.equal(r.error.remainingLiters, 10);
    }
    assert.equal(q.used.value, 90);
  });

  test('não permite reduzir o limite abaixo do já consumido', () => {
    const q = quota();
    q.debit(unwrap(Liters.create(60)));
    const r = q.changeLimit(unwrap(Liters.create(50)));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, 'QUOTA_BELOW_USAGE');
  });
});

describe('Vehicle (hodômetro)', () => {
  const vehicle = () =>
    unwrap(
      Vehicle.create({
        id: 'v1',
        plate: unwrap(Plate.create('ABC1234')),
        model: 'Gol',
        department: 'Educação',
        fuelType: 'ETANOL',
        expectedKmPerLiter: 8,
        initialOdometer: Odometer.restore(5000),
        now: new Date(),
      }),
    );

  test('recusa hodômetro menor que o último registrado', () => {
    const r = vehicle().evaluateRefuel(Odometer.restore(4999), unwrap(Liters.create(10)));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, 'ODOMETER_REGRESSION');
  });

  test('calcula km/L e sinaliza consumo fora da tolerância de 40%', () => {
    const v = vehicle();
    const normal = unwrap(v.evaluateRefuel(Odometer.restore(5400), unwrap(Liters.create(50)))); // 8 km/L
    assert.equal(normal.kmPerLiter, 8);
    assert.equal(normal.suspicious, false);
    const weird = unwrap(v.evaluateRefuel(Odometer.restore(5050), unwrap(Liters.create(50)))); // 1 km/L
    assert.equal(weird.suspicious, true);
  });

  test('rejeita combustível desconhecido', () => {
    const r = Vehicle.create({
      id: 'x',
      plate: unwrap(Plate.create('ABC1234')),
      model: 'Gol',
      department: 'Obras',
      fuelType: 'GNV',
      expectedKmPerLiter: 10,
      now: new Date(),
    });
    assert.equal(r.ok, false);
  });
});
