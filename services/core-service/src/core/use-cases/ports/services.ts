export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

/** Armazenamento da foto do hodômetro (disco local, S3, MinIO...). */
export interface PhotoStorage {
  /** Deve ser idempotente: salvar a mesma chave duas vezes sobrescreve. */
  save(key: string, base64: string, mimeType: string): Promise<string>;
  read(key: string): Promise<{ data: Uint8Array; mimeType: string } | null>;
}
