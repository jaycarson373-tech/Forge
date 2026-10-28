import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve, extname } from 'node:path';
import { Store } from './store.js';
import { inspectMint } from './inspect.js';
import { execute, makeCoin, quote } from '../src/domain.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
if (existsSync('.env')) loadEnvFile('.env');
const store = new Store(process.env.DATA_PATH || 'data/forge.sqlite');
const mime: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const cache = new Map<string, { time: number; value: unknown }>();
function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? String(v) : v)));
}
async function body(req: IncomingMessage) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 16384) throw new Error('Request is too large.');
  }
  return JSON.parse(text || '{}');
}
export const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const url = new URL(req.url || '/', 'http://localhost');
  try {
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host)
        return send(res, 403, { error: 'Cross-origin writes are disabled.' });
      if (!req.headers['content-type']?.startsWith('application/json'))
        return send(res, 415, { error: 'Use application/json.' });
    }
    if (req.method === 'GET' && url.pathname === '/api/config')
      return send(res, 200, {
        mode: 'paper',
        balanceLabel: 'Paper SOL',
        sdk: '2.0.0',
        liveTransactions: false,
      });
    if (req.method === 'GET' && url.pathname === '/api/paper') return send(res, 200, store.read());
    if (req.method === 'POST' && url.pathname === '/api/paper/create') {
      const input = await body(req);
      const coin = makeCoin(input.name, input.ticker, input.description, input.mode);
      store.update((s) => {
        if (s.coins.length >= 200)
          throw new Error('Paper launch limit reached. Reset the sandbox to continue.');
        s.coins.unshift(coin);
      });
      return send(res, 201, coin);
    }
    if (req.method === 'POST' && url.pathname === '/api/paper/quote') {
      const input = await body(req);
      if (input.side !== 'buy' && input.side !== 'sell') throw new Error('Invalid side.');
      if (typeof input.amount !== 'string' || !/^\d{1,32}$/.test(input.amount))
        throw new Error('Invalid amount.');
      const coin = store.read().coins.find((c) => c.id === input.coinId);
      if (!coin) throw new Error('Coin not found.');
      const q = quote(coin, input.side, BigInt(input.amount), Math.floor(Date.now() / 400));
      return send(res, 200, {
        output: String(q.output),
        fee: String(q.fee),
        bps: String(q.bps),
        version: coin.version,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/paper/trade') {
      const input = await body(req);
      return send(
        res,
        200,
        store.update((s) => execute(s, input)),
      );
    }
    if (req.method === 'POST' && url.pathname === '/api/paper/reset') {
      await body(req);
      store.reset();
      return send(res, 200, store.read());
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/inspect/')) {
      const address = url.pathname.slice('/api/inspect/'.length);
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))
        throw new Error('Invalid Solana address.');
      const old = cache.get(address);
      if (old && Date.now() - old.time < 60000) return send(res, 200, old.value);
      const value = await inspectMint(address);
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(address, { time: Date.now(), value });
      return send(res, 200, value);
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Route not found.' });
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return send(res, 405, { error: 'Method not allowed.' });
    const base = resolve('dist');
    let file = resolve(base, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(base + '\\') && !file.startsWith(base + '/') && file !== base)
      return send(res, 403, { error: 'Forbidden.' });
    if (!extname(file)) file = resolve(base, 'index.html');
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (error) {
    send(res, 400, { error: error instanceof Error ? error.message : 'Request failed.' });
  }
});
server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () =>
  console.log(
    `Forge → http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 8787} · paper mode`,
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit(0);
    }),
  );
