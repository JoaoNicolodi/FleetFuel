import { randomUUID } from 'node:crypto';
import { Clock, IdGenerator } from '../core/use-cases/ports/services';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class UuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
