import type { IncomingMessage, ServerResponse } from 'node:http';
import { LiveStore } from './live-store.js';
import { LiveChain, asKey } from './live-chain.js';
import { RateLimit, type Runtime } from './runtime.js';
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
export async function readJSON(req: IncomingMessage, max = 2_000_000) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}
export function validImage(value: unknown) {
  if (typeof value !== 'string' || value.length > 1_500_000)
    throw new Error('Upload a PNG or JPEG under 1 MB.');
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) throw new Error('Only PNG and JPEG images are supported.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 1_000_000 || bytes.length < 8) throw new Error('Image must be under 1 MB.');
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (match[1] === 'png' ? !png : !jpeg) throw new Error('Image file signature is invalid.');
  return { bytes, type: `image/${match[1]}` };
}
export class LiveHTTP {
  readonly store: LiveStore;
  readonly chain: LiveChain;
  private publicLimit = new RateLimit(180);
  private writeLimit = new RateLimit(30);
  private authLimit = new RateLimit(10);
  private inflight = 0;
  constructor(readonly runtime: Runtime) {
    this.store = new LiveStore(runtime.dataPath);
    this.chain = new LiveChain(runtime, this.store);
  }
  wallet(req: IncomingMessage) {
    const token = req.headers.authorization?.replace(/^Bearer /, '') || '';
    const wallet = this.store.session(token);
    if (!wallet) throw new HttpError(401, 'Sign in with your wallet to continue.');
    return wallet;
  }
  async handle(req: IncomingMessage, res: ServerResponse, url: URL) {
    const path = url.pathname,
      ip = req.socket.remoteAddress || 'unknown';
    if (path.startsWith('/media/') || path.startsWith('/metadata/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD')
        throw new HttpError(405, 'Method not allowed.');
      const id = path.split('/')[2]?.split('.')[0];
      if (!/^[a-f0-9]{64}$/.test(id || '')) throw new HttpError(404, 'Asset not found.');
      const row = this.store.db
        .prepare('SELECT type,bytes FROM live_assets WHERE hash=?')
        .get(id) as { type: string; bytes: Uint8Array } | undefined;
      if (
        !row ||
        (path.startsWith('/metadata/') && row.type !== 'application/json') ||
        (path.startsWith('/media/') && !row.type.startsWith('image/'))
      )
        throw new HttpError(404, 'Asset not found.');
      res.writeHead(200, {
        'Content-Type': row.type,
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(row.bytes));
      return true;
    }
    if (!path.startsWith('/api/live/')) return false;
    if (!this.publicLimit.take(ip))
      throw new HttpError(429, 'Too many requests. Try again shortly.');
    if (req.method === 'POST' && !this.writeLimit.take(ip))
      throw new HttpError(429, 'Too many write requests. Try again shortly.');
    if (this.inflight >= 20) throw new HttpError(503, 'RPC capacity is busy. Retry shortly.');
    this.inflight++;
    try {
      if (req.method === 'GET' && path === '/api/live/status') {
        json(res, 200, await this.chain.status());
        return true;
      }
      if (req.method === 'GET' && path === '/api/live/markets') {
        json(res, 200, await this.chain.markets());
        return true;
      }
      if (req.method === 'GET' && path === '/api/live/market') {
        json(res, 200, await this.chain.market(asKey(url.searchParams.get('mint')).toBase58()));
        return true;
      }
      if (req.method === 'GET' && path === '/api/live/balance') {
        json(res, 200, await this.chain.balance(asKey(url.searchParams.get('wallet')).toBase58()));
        return true;
      }
      if (req.method === 'GET' && path === '/api/live/positions') {
        json(
          res,
          200,
          await this.chain.positions(asKey(url.searchParams.get('wallet')).toBase58()),
        );
        return true;
      }
      if (req.method === 'GET' && path === '/api/live/transaction') {
        json(
          res,
          200,
          await this.chain.transaction(this.wallet(req), url.searchParams.get('id') || ''),
        );
        return true;
      }
      if (req.method !== 'POST') throw new HttpError(404, 'Route not found.');
      const input = await readJSON(req);
      if (path === '/api/live/auth/challenge') {
        if (!this.authLimit.take(ip)) throw new HttpError(429, 'Too many sign-in attempts.');
        json(
          res,
          200,
          this.store.challenge(asKey(input.wallet).toBase58(), this.runtime.publicUrl),
        );
        return true;
      }
      if (path === '/api/live/auth/verify') {
        json(res, 200, this.store.authenticate(input.id, input.signature));
        return true;
      }
      if (path === '/api/live/quote') {
        json(
          res,
          200,
          await this.chain.quote(
            asKey(input.mint).toBase58(),
            input.side,
            input.amount,
            input.slippageBps,
          ),
        );
        return true;
      }
      const wallet = this.wallet(req);
      if (path === '/api/live/auth/logout') {
        this.store.logout(req.headers.authorization?.replace(/^Bearer /, '') || '');
        json(res, 200, { ok: true });
        return true;
      }
      if (path === '/api/live/setup') {
        json(res, 200, await this.chain.setup(wallet, asKey(input.config).toBase58()));
        return true;
      }
      if (path === '/api/live/config/register') {
        json(res, 200, await this.chain.register(wallet, asKey(input.config).toBase58()));
        return true;
      }
      if (path === '/api/live/metadata') {
        if (!this.runtime.transactionsEnabled) throw new Error('Live creation is disabled.');
        await this.chain.configured();
        const mint = asKey(input.mint).toBase58();
        if (
          typeof input.name !== 'string' ||
          !input.name.trim() ||
          Buffer.byteLength(input.name.trim()) > 32 ||
          typeof input.ticker !== 'string' ||
          !/^[A-Z0-9]{2,10}$/.test(input.ticker) ||
          typeof input.description !== 'string' ||
          input.description.length > 1000
        )
          throw new Error('Invalid coin name, ticker or description.');
        const count = this.store.db
          .prepare('SELECT COUNT(*) AS n FROM live_coins WHERE creator=? AND created>?')
          .get(wallet, Date.now() - 86400000) as { n: number };
        if (count.n >= 5) throw new HttpError(429, 'Daily launch limit reached for this wallet.');
        if (
          (this.store.db.prepare('SELECT COUNT(*) AS n FROM live_assets').get() as { n: number })
            .n >= 10000
        )
          throw new HttpError(503, 'Metadata capacity reached. Contact the operator.');
        const image = validImage(input.image);
        const imageHash = this.store.asset(image.type, image.bytes);
        const imageUrl = `${this.runtime.publicUrl}/media/${imageHash}.${image.type === 'image/png' ? 'png' : 'jpg'}`;
        const metadata = {
          name: input.name.trim(),
          symbol: input.ticker,
          description: input.description,
          image: imageUrl,
          external_url: this.runtime.publicUrl,
          properties: { files: [{ uri: imageUrl, type: image.type }], category: 'image' },
        };
        const id = this.store.asset('application/json', Buffer.from(JSON.stringify(metadata)));
        const uri = `${this.runtime.publicUrl}/metadata/${id}.json`;
        if (uri.length > 200) throw new Error('PUBLIC_URL is too long for a metadata URI.');
        this.store.db
          .prepare('INSERT INTO live_coins VALUES(?,?,?,?,?,?,?,?)')
          .run(
            mint,
            metadata.name,
            input.ticker,
            input.description,
            imageUrl,
            uri,
            wallet,
            Date.now(),
          );
        json(res, 201, { mint, name: metadata.name, ticker: input.ticker, uri, image: imageUrl });
        return true;
      }
      if (path === '/api/live/launch') {
        json(res, 200, await this.chain.launch(wallet, asKey(input.mint).toBase58(), input));
        return true;
      }
      if (path === '/api/live/swap') {
        json(res, 200, await this.chain.swap(wallet, input));
        return true;
      }
      if (path === '/api/live/claim') {
        if (!['creator', 'partner'].includes(input.role)) throw new Error('Invalid fee role.');
        json(res, 200, await this.chain.claim(wallet, asKey(input.mint).toBase58(), input.role));
        return true;
      }
      if (path === '/api/live/send') {
        json(res, 200, await this.chain.send(wallet, input.id, input.transaction));
        return true;
      }
      if (path === '/api/live/claim-position') {
        json(res, 200, await this.chain.claimPosition(wallet, asKey(input.position).toBase58()));
        return true;
      }
      throw new HttpError(404, 'Route not found.');
    } finally {
      this.inflight--;
    }
  }
  close() {
    this.store.close();
  }
}
