/** Fato de abastecimento (read model alimentado pelos eventos). */
export interface RefuelFact {
  refuelId: string;
  vehicleId: string;
  plate: string;
  department: string;
  month: string;
  status: 'ACCEPTED' | 'FLAGGED' | 'REJECTED';
  liters: number;
  totalCents: number;
  distanceKm: number | null;
  offline: boolean;
  rejectionCode: string | null;
}

export interface VehicleReportLine {
  vehicleId: string;
  plate: string;
  department: string;
  refuels: number;
  rejected: number;
  flagged: number;
  liters: number;
  totalCents: number;
  distanceKm: number;
  avgKmPerLiter: number | null;
  avgPricePerLiterCents: number | null;
}

export interface DepartmentReportLine {
  department: string;
  vehicles: number;
  liters: number;
  totalCents: number;
}

export interface MonthlyReport {
  month: string;
  totals: { refuels: number; rejected: number; flagged: number; offline: number; liters: number; totalCents: number };
  byVehicle: VehicleReportLine[];
  byDepartment: DepartmentReportLine[];
  rejectionReasons: Record<string, number>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Fechamento mensal: regras de consolidação puras (sem banco).
 * Rejeitados entram na contagem mas NÃO somam litros nem valor.
 */
export function buildMonthlyReport(month: string, facts: RefuelFact[]): MonthlyReport {
  const byVehicle = new Map<string, VehicleReportLine & { kmForAvg: number; litersForAvg: number }>();
  const rejectionReasons: Record<string, number> = {};
  const totals = { refuels: 0, rejected: 0, flagged: 0, offline: 0, liters: 0, totalCents: 0 };

  for (const f of facts.filter((x) => x.month === month)) {
    const line =
      byVehicle.get(f.vehicleId) ??
      { vehicleId: f.vehicleId, plate: f.plate, department: f.department, refuels: 0, rejected: 0, flagged: 0, liters: 0, totalCents: 0, distanceKm: 0, avgKmPerLiter: null, avgPricePerLiterCents: null, kmForAvg: 0, litersForAvg: 0 };
    if (f.offline) totals.offline += 1;
    if (f.status === 'REJECTED') {
      line.rejected += 1;
      totals.rejected += 1;
      const code = f.rejectionCode ?? 'UNKNOWN';
      rejectionReasons[code] = (rejectionReasons[code] ?? 0) + 1;
    } else {
      line.refuels += 1;
      line.liters = round2(line.liters + f.liters);
      line.totalCents += f.totalCents;
      totals.refuels += 1;
      totals.liters = round2(totals.liters + f.liters);
      totals.totalCents += f.totalCents;
      if (f.status === 'FLAGGED') {
        line.flagged += 1;
        totals.flagged += 1;
      }
      if (f.distanceKm !== null) {
        line.distanceKm += f.distanceKm;
        line.kmForAvg += f.distanceKm;
        line.litersForAvg += f.liters;
      }
    }
    byVehicle.set(f.vehicleId, line);
  }

  const vehicles = [...byVehicle.values()]
    .map(({ kmForAvg, litersForAvg, ...l }) => ({
      ...l,
      avgKmPerLiter: litersForAvg > 0 ? round2(kmForAvg / litersForAvg) : null,
      avgPricePerLiterCents: l.liters > 0 ? Math.round(l.totalCents / l.liters) : null,
    }))
    .sort((a, b) => b.totalCents - a.totalCents);

  const deps = new Map<string, DepartmentReportLine>();
  for (const v of vehicles) {
    const d = deps.get(v.department) ?? { department: v.department, vehicles: 0, liters: 0, totalCents: 0 };
    d.vehicles += 1;
    d.liters = round2(d.liters + v.liters);
    d.totalCents += v.totalCents;
    deps.set(v.department, d);
  }

  return {
    month,
    totals,
    byVehicle: vehicles,
    byDepartment: [...deps.values()].sort((a, b) => b.totalCents - a.totalCents),
    rejectionReasons,
  };
}
