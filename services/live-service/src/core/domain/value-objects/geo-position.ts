import { Result, ok, fail } from '../shared/result';
import { ValidationError } from '../shared/errors';

/** Coordenada GPS recebida do celular do motorista. */
export class GeoPosition {
  private constructor(
    readonly lat: number,
    readonly lng: number,
    readonly speedKmh: number | null,
    readonly recordedAt: Date,
  ) {}

  static create(input: { lat: number; lng: number; speedKmh?: number | null; recordedAt: string | Date }): Result<GeoPosition, ValidationError> {
    const { lat, lng } = input;
    if (typeof lat !== 'number' || Math.abs(lat) > 90) return fail(new ValidationError('lat', 'Latitude inválida'));
    if (typeof lng !== 'number' || Math.abs(lng) > 180) return fail(new ValidationError('lng', 'Longitude inválida'));
    const speed = input.speedKmh ?? null;
    if (speed !== null && (speed < 0 || speed > 250)) return fail(new ValidationError('speedKmh', 'Velocidade fora do intervalo'));
    const recordedAt = new Date(input.recordedAt);
    if (Number.isNaN(recordedAt.getTime())) return fail(new ValidationError('recordedAt', 'Data inválida'));
    return ok(new GeoPosition(lat, lng, speed, recordedAt));
  }

  toJSON() {
    return { lat: this.lat, lng: this.lng, speedKmh: this.speedKmh, recordedAt: this.recordedAt.toISOString() };
  }
}
