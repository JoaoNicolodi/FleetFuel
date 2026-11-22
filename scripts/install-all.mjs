#!/usr/bin/env node
// Instala as dependências de todos os projetos. Funciona em Windows, Linux e Mac.
import { execSync } from 'node:child_process';
const dirs = ['services/core-service', 'services/live-service', 'services/audit-service', 'web', 'mobile'];
for (const dir of dirs) {
  console.log(`\n=== npm install em ${dir} ===`);
  execSync('npm install', { cwd: dir, stdio: 'inherit', shell: true });
}
console.log('\n✅ Dependências instaladas em todos os projetos');
