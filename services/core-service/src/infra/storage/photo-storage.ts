import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { PhotoStorage } from '../../core/use-cases/ports/services';

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

/** Grava as fotos do hodômetro em disco (volume Docker). Em produção seria S3/MinIO. */
export class LocalDiskPhotoStorage implements PhotoStorage {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  async save(key: string, base64: string, mimeType: string): Promise<string> {
    const clean = base64.replace(/^data:[^;]+;base64,/, '');
    const fullKey = `${key}.${EXT[mimeType] ?? 'bin'}`;
    const path = this.safePath(fullKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(clean, 'base64'));
    return fullKey;
  }

  async read(key: string) {
    try {
      const data = await readFile(this.safePath(key));
      const mimeType = key.endsWith('.png') ? 'image/png' : 'image/jpeg';
      return { data, mimeType };
    } catch {
      return null;
    }
  }

  /** Impede path traversal (ex: key = "../../etc/passwd"). */
  private safePath(key: string): string {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root)) throw new Error('Caminho de foto inválido');
    return p;
  }
}

export class InMemoryPhotoStorage implements PhotoStorage {
  readonly files = new Map<string, { data: Uint8Array; mimeType: string }>();
  async save(key: string, base64: string, mimeType: string) {
    const fullKey = `${key}.${EXT[mimeType] ?? 'bin'}`;
    this.files.set(fullKey, { data: Buffer.from(base64, 'base64'), mimeType });
    return fullKey;
  }
  async read(key: string) {
    return this.files.get(key) ?? null;
  }
}
