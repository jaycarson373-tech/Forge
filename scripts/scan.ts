import { inspectMint, TARGET } from '../server/inspect.js';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
if (existsSync('.env')) loadEnvFile('.env');
try {
  console.log(
    JSON.stringify(
      await inspectMint(process.argv[2] || TARGET),
      (_, v) => (typeof v === 'bigint' ? String(v) : v),
      2,
    ),
  );
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
