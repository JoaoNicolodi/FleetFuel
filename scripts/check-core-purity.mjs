#!/usr/bin/env node
/**
 * Garante a regra da Clean Architecture: nada dentro de src/core pode importar
 * bibliotecas externas (ORM, driver de banco, framework web, broker...) nem a camada infra.
 * Só imports relativos dentro do próprio core são permitidos.
 *
 * Uso: node scripts/check-core-purity.mjs services/core-service/src/core
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error('Uso: check-core-purity.mjs <pasta-core> [...]');
  process.exit(2);
}

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const violations = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name)) check(p);
  }
}

function check(file) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec.startsWith('.')) {
      violations.push(`${file}: importa pacote externo "${spec}"`);
      continue;
    }
    const target = resolve(join(file, '..', spec));
    const coreRoot = roots.map((r) => resolve(r)).find((r) => file.startsWith(r));
    if (coreRoot && relative(coreRoot, target).startsWith('..')) {
      violations.push(`${file}: importa fora do core "${spec}"`);
    }
  }
}

roots.forEach((r) => walk(resolve(r)));

if (violations.length) {
  console.error('❌ Violações da Clean Architecture:\n' + violations.join('\n'));
  process.exit(1);
}
console.log(`✅ core puro: nenhum import externo em ${roots.join(', ')}`);
