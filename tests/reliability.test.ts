import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReadCache } from '../server/read-cache.js';
import { WalletSession } from '../src/live/client.js';
import { allowedOrigin } from '../server/runtime.js';
test('development accepts its configured frontend origin while production rejects alternate origins', () => {
  const dev = { production: false, publicUrl: 'http://127.0.0.1:5173' };
  assert(allowedOrigin('http://127.0.0.1:5173', '127.0.0.1:8787', dev));
  assert(allowedOrigin('http://localhost:5173', '127.0.0.1:8787', dev));
  assert(!allowedOrigin('https://evil.example', '127.0.0.1:8787', dev));
  const prod = { production: true, publicUrl: 'https://forge.example' };
  assert(allowedOrigin('https://forge.example', 'localhost:8787', prod));
  assert(!allowedOrigin('http://localhost:5173', 'localhost:5173', prod));
  assert(!allowedOrigin('https://forge.example.evil.com', 'localhost:8787', prod));
});
test('display reads share in-flight work and failed reads can be retried', async () => {
  const cache = new ReadCache();
  let calls = 0,
    finish!: (v: number) => void;
  const read = () => {
    calls++;
    return new Promise<number>((r) => {
      finish = r;
    });
  };
  const a = cache.get('market', 1000, read),
    b = cache.get('market', 1000, read);
  finish(42);
  assert.deepEqual(await Promise.all([a, b]), [42, 42]);
  assert.equal(calls, 1);
  assert.equal(await cache.get('market', 1000, read), 42);
  await assert.rejects(() =>
    cache.get('failed', 1000, async () => {
      throw new Error('RPC unavailable');
    }),
  );
  assert.equal(await cache.get('failed', 1000, async () => 7), 7);
});
test('wallet sessions renew before expiry and clear on wallet changes', async () => {
  const cache = new WalletSession();
  let logins = 0;
  const login = async () => ({
    wallet: 'A',
    token: String(++logins),
    expires: Date.now() + 3600000,
  });
  assert.equal(await cache.get('A', login), '1');
  assert.equal(await cache.get('A', login), '1');
  cache.clear();
  assert.equal(
    await cache.get('A', async () => ({ wallet: 'A', token: 'short', expires: Date.now() + 1000 })),
    'short',
  );
  assert.equal(await cache.get('A', login), '2');
  cache.clear();
  let resolve!: (v: { wallet: string; token: string; expires: number }) => void;
  const pending = cache.get(
    'A',
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  cache.clear();
  resolve({ wallet: 'A', token: 'stale', expires: Date.now() + 3600000 });
  await assert.rejects(() => pending, /Wallet changed/);
});
