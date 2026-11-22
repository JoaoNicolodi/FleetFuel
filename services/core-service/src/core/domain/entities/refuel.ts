import { CompetenceMonth } from '../value-objects/competence-month';
import { Liters } from '../value-objects/liters';
import { Money } from '../value-objects/money';
import { Odometer } from '../value-objects/odometer';

/**
 * ACCEPTED  -> debitado da cota, consumo dentro do esperado.
 * FLAGGED   -> debitado da cota, mas consumo fora do padrão: gestor deve revisar a foto do hodômetro.
 * REJECTED  -> não debitado (cota estourada, hodômetro regrediu, sem cota). Fica registrado para auditoria.
 */
export type RefuelStatus = 'ACCEPTED' | 'FLAGGED' | 'REJECTED';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface RefuelProps {
  id: string;
  clientId: string; // UUID gerado no celular = chave de idempotência
  vehicleId: string;
  plate: string;
  driverName: string;
  stationName: string;
  month: CompetenceMonth;
  liters: Liters;
  odometer: Odometer;
  pricePerLiter: Money;
  total: Money;
  occurredAt: Date; // quando aconteceu no posto (pode ser offline)
  receivedAt: Date; // quando chegou ao servidor
  offline: boolean;
  photoKey: string;
  location: GeoPoint | null;
  status: RefuelStatus;
  distanceKm: number | null;
  kmPerLiter: number | null;
  reviewReason: string | null;
  rejectionCode: string | null;
  quotaRemainingLiters: number | null;
}

type CommonInput = Omit<
  RefuelProps,
  'status' | 'total' | 'distanceKm' | 'kmPerLiter' | 'reviewReason' | 'rejectionCode' | 'quotaRemainingLiters'
>;

/** Registro de abastecimento. Imutável depois de criado. */
export class Refuel {
  private constructor(private readonly props: RefuelProps) {}

  static accept(
    input: CommonInput & {
      distanceKm: number | null;
      kmPerLiter: number | null;
      reviewReason: string | null;
      quotaRemainingLiters: number;
    },
  ): Refuel {
    return new Refuel({
      ...input,
      total: Money.total(input.pricePerLiter, input.liters.milliliters),
      status: input.reviewReason ? 'FLAGGED' : 'ACCEPTED',
      rejectionCode: null,
    });
  }

  static reject(input: CommonInput & { rejectionCode: string; reviewReason: string }): Refuel {
    return new Refuel({
      ...input,
      total: Money.total(input.pricePerLiter, input.liters.milliliters),
      status: 'REJECTED',
      distanceKm: null,
      kmPerLiter: null,
      quotaRemainingLiters: null,
    });
  }

  static restore(props: RefuelProps): Refuel {
    return new Refuel({ ...props });
  }

  get id() { return this.props.id; }
  get clientId() { return this.props.clientId; }
  get vehicleId() { return this.props.vehicleId; }
  get status() { return this.props.status; }
  get isRejected() { return this.props.status === 'REJECTED'; }
  get rejectionCode() { return this.props.rejectionCode; }

  /** Cópia somente-leitura dos dados (para DTOs, eventos e persistência). */
  snapshot(): Readonly<RefuelProps> {
    return { ...this.props };
  }
}
