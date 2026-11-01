import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type RequestListener, type Server } from 'node:http';
import { once } from 'node:events';
import { createHostingHandler } from '../server/hosting.js';
import { LiveHTTP } from '../server/live-http.js';
import { readRuntime, GENESIS } from '../server/runtime.js';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';

async function listen(handler: RequestListener) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}
const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
const publicUrl = 'https://forge.example';
const productionEnv = { NODE_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'forge.example' };

test('Vercel rewrite serves config and health, blocks writes even when mainnet flag is set', async () => {
  const app = await listen(
    createHostingHandler({ ...productionEnv, ENABLE_MAINNET_TRANSACTIONS: 'true' }),
  );
  try {
    const config = await fetch(`${app.origin}/api/forge?__forge_path=/api/config`);
    assert.equal(config.status, 200);
    assert.match(config.headers.get('content-type') || '', /application\/json/);
    assert.deepEqual(await config.json(), {
      mode: 'live',
      balanceLabel: 'SOL',
      sdk: '2.0.0',
      liveTransactions: false,
      backendRequired: true,
    });
    assert.equal((await fetch(`${app.origin}/api/forge?__forge_path=/healthz`)).status, 200);
    assert.equal((await fetch(`${app.origin}/readyz`)).status, 503);
    for (const path of ['auth/challenge', 'metadata', 'setup', 'swap', 'send', 'quote']) {
      const response = await fetch(`${app.origin}/api/live/${path}`, {
        method: 'POST',
        headers: { Origin: publicUrl, 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, 'PERSISTENT_BACKEND_REQUIRED');
    }
    const foreign = await fetch(`${app.origin}/api/live/send`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(foreign.status, 403);
    assert.equal(
      (await fetch(`${app.origin}/api/forge?__forge_path=https://evil.example`)).status,
      404,
    );
  } finally {
    await close(app.server);
  }
});

test('Vercel live status uses SDK runtime but cannot enable transactions on devnet', async (t) => {
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === 'https://rpc.example/') {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.method, 'getGenesisHash');
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: GENESIS.devnet }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return nativeFetch(input, init);
  });
  const app = await listen(
    createHostingHandler({
      ...productionEnv,
      SOLANA_CLUSTER: 'devnet',
      SOLANA_RPC_URL: 'https://rpc.example/',
    }),
  );
  try {
    const response = await fetch(`${app.origin}/api/live/status`);
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.rpcReady, true);
    assert.equal(status.transactionsEnabled, false);
    assert.equal(status.launchEnabled, false);
    assert.equal(status.backendRequired, true);
    assert.equal(status.publicUrl, publicUrl);
  } finally {
    await close(app.server);
  }
});

test('proxy preserves signed auth across separate function instances, query strings and binary assets', async () => {
  const live = new LiveHTTP(readRuntime({ PUBLIC_URL: publicUrl, DATA_PATH: ':memory:' }));
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const id = live.store.asset('image/png', image);
  const backend = await listen(async (req, res) => {
    if (req.url?.startsWith('/api/echo?')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ url: req.url, authorization: req.headers.authorization }));
      return;
    }
    try {
      if (await live.handle(req, res, new URL(req.url || '/', publicUrl))) return;
      res.writeHead(404);
      res.end();
    } catch {
      res.writeHead(400);
      res.end();
    }
  });
  const env = { PUBLIC_URL: publicUrl, FORGE_API_ORIGIN: backend.origin };
  const first = await listen(createHostingHandler(env));
  const second = await listen(createHostingHandler(env));
  try {
    const wallet = Keypair.generate();
    const post = (origin: string, path: string, data: unknown) =>
      fetch(`${origin}/api/forge?__forge_path=/api/live/${path}`, {
        method: 'POST',
        headers: { Origin: publicUrl, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    const challenge = await (
      await post(first.origin, 'auth/challenge', { wallet: wallet.publicKey.toBase58() })
    ).json();
    const signature = Buffer.from(
      nacl.sign.detached(Buffer.from(challenge.message), wallet.secretKey),
    ).toString('base64');
    const response = await post(second.origin, 'auth/verify', { id: challenge.id, signature });
    assert.equal(response.status, 200);
    const session = await response.json();
    assert.equal(session.wallet, wallet.publicKey.toBase58());
    assert.equal(live.store.session(session.token), wallet.publicKey.toBase58());
    const echo = await (
      await fetch(`${first.origin}/api/forge?__forge_path=/api/echo&mint=a%2Bb&wallet=abc`, {
        headers: { Authorization: `Bearer ${session.token}` },
      })
    ).json();
    assert.equal(echo.authorization, `Bearer ${session.token}`);
    assert.equal(echo.url, '/api/echo?mint=a%2Bb&wallet=abc');
    const asset = await fetch(`${second.origin}/api/forge?__forge_path=/media/${id}.png`);
    assert.equal(asset.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()), image);
  } finally {
    await Promise.all([close(first.server), close(second.server), close(backend.server)]);
    live.close();
  }
});

test('unsafe production backend config fails as JSON instead of a function crash', async () => {
  for (const origin of [
    'http://backend.example',
    publicUrl,
    'https://user:pass@backend.example',
    'https://backend.example/path',
  ]) {
    const app = await listen(createHostingHandler({ ...productionEnv, FORGE_API_ORIGIN: origin }));
    try {
      const response = await fetch(`${app.origin}/api/config`);
      assert.equal(response.status, 500);
      assert.match((await response.json()).error, /FORGE_API_ORIGIN/);
    } finally {
      await close(app.server);
    }
  }
});
