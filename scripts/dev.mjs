import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
if (existsSync('.env')) loadEnvFile('.env');
const children = [
  spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    stdio: 'inherit',
    env: { ...process.env, PUBLIC_URL: process.env.PUBLIC_URL || 'http://127.0.0.1:5173' },
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
    stdio: 'inherit',
    env: { ...process.env, FORGE_API_URL: `http://127.0.0.1:${process.env.PORT || 8787}` },
  }),
];
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    for (const p of children) p.kill();
  });
for (const p of children)
  p.on('exit', (code) => {
    for (const other of children) if (other !== p) other.kill();
    process.exit(code || 0);
  });
