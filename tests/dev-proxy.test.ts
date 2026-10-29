import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { LiveStore } from '../server/live-store.js';
import { Keypair } from '@solana/web3.js';
test('development proxy serves real API, immutable metadata and image bytes on one origin', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'forge-proxy-')),
    path = join(temp, 'test.sqlite');
  const store = new LiveStore(path);
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const imageId = store.asset('image/png', image),
    jsonId = store.asset(
      'application/json',
      Buffer.from(JSON.stringify({ name: 'Proxy Test', image: `/media/${imageId}.png` })),
    );
  store.close();
  const children: ChildProcess[] = [];
  let logs = '';
  try {
    const api = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        APP_MODE: 'live',
        PORT: '18790',
        PUBLIC_URL: 'http://127.0.0.1:18791',
        PLATFORM_FEE_WALLET: '',
        DBC_CONFIG_ADDRESS: '',
        DATA_PATH: path,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(api);
    const vite = spawn(
      process.execPath,
      ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '18791'],
      {
        env: { ...process.env, FORGE_API_URL: 'http://127.0.0.1:18790' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    children.push(vite);
    for (const p of children) {
      p.stdout?.on('data', (b) => {
        logs += b;
      });
      p.stderr?.on('data', (b) => {
        logs += b;
      });
    }
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try {
        const r = await fetch('http://127.0.0.1:18791/api/config');
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(ready, logs);
    const config = (await (await fetch('http://127.0.0.1:18791/api/config')).json()) as {
      mode: string;
      balanceLabel: string;
    };
    assert.equal(config.mode, 'live');
    assert.equal(config.balanceLabel, 'SOL');
    const metadata = await fetch(`http://127.0.0.1:18791/metadata/${jsonId}.json`);
    assert.equal(metadata.headers.get('content-type'), 'application/json');
    assert.equal(((await metadata.json()) as { name: string }).name, 'Proxy Test');
    const bytes = await fetch(`http://127.0.0.1:18791/media/${imageId}.png`);
    assert.equal(bytes.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), image);
    const auth = await fetch('http://127.0.0.1:18791/api/live/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:18791' },
      body: JSON.stringify({ wallet: Keypair.generate().publicKey.toBase58() }),
    });
    assert.equal(auth.status, 200, 'Same-origin writes must work through the development proxy');
  } finally {
    for (const p of children) p.kill();
    await Promise.all(
      children.map(
        (p) =>
          new Promise<void>((r) => {
            if (p.exitCode !== null) r();
            else p.once('exit', () => r());
          }),
      ),
    );
    if (!resolve(temp).startsWith(resolve(tmpdir()) + sep))
      throw new Error('Unexpected cleanup directory');
    await rm(temp, { recursive: true, force: true });
  }
});
