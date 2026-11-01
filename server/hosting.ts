import type { IncomingMessage, ServerResponse } from 'node:http';
import { allowedOrigin, readRuntime, type Runtime } from './runtime.js';
import type { LiveHTTP } from './live-http.js';

const BACKEND_REQUIRED =
  'Trading is not configured on this deployment. Connect a persistent Forge backend in the host settings.';
const readPaths = new Set([
  '/api/live/markets',
  '/api/live/featured',
  '/api/live/market',
  '/api/live/balance',
  '/api/live/positions',
]);
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
function hostingRuntime(env: NodeJS.ProcessEnv) {
  const host = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  const runtime = readRuntime({
    ...env,
    PUBLIC_URL: env.PUBLIC_URL || (host ? `https://${host}` : undefined),
    APP_MODE: 'live',
    DATA_PATH: ':memory:',
    ENABLE_MAINNET_TRANSACTIONS: 'false',
  });
  // Devnet normally enables transactions too; preview must never authorize writes.
  return { ...runtime, transactionsEnabled: false };
}
function backendOrigin(value: string, runtime: Runtime) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !['http:', 'https:'].includes(url.protocol) ||
    (runtime.production && url.protocol !== 'https:')
  )
    throw new Error('FORGE_API_ORIGIN must be an HTTPS origin without a path or credentials.');
  if (url.origin === runtime.publicUrl)
    throw new Error('FORGE_API_ORIGIN must point to the backend, not this website.');
  return url.origin;
}
async function proxyBody(req: IncomingMessage & { body?: unknown }) {
  if (req.body !== undefined) {
    const body = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    if (body.length > 2_000_000) throw new Error('Request is too large.');
    return body;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 2_000_000) throw new Error('Request is too large.');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export function createHostingHandler(env: NodeJS.ProcessEnv = process.env) {
  // Initialize lazily so an invalid operator setting produces JSON, not a crashed function.
  let runtime: Runtime | undefined;
  let preview: Promise<LiveHTTP> | undefined;
  const getPreview = async (settings: Runtime) => {
    if (!preview) preview = import('./live-http.js').then(({ LiveHTTP }) => new LiveHTTP(settings));
    try {
      return await preview;
    } catch (error) {
      preview = undefined;
      throw error;
    }
  };
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      runtime ||= hostingRuntime(env);
      const url = new URL(req.url || '/', runtime.publicUrl);
      const path = url.searchParams.get('__forge_path') || url.pathname;
      url.searchParams.delete('__forge_path');
      if (
        !path.startsWith('/api/') &&
        !path.startsWith('/media/') &&
        !path.startsWith('/metadata/') &&
        path !== '/healthz' &&
        path !== '/readyz'
      )
        return json(res, 404, { error: 'Route not found.' });
      // Assign pathname rather than resolving an untrusted path as a URL.
      url.pathname = path;
      if (!['GET', 'HEAD', 'POST'].includes(req.method || ''))
        return json(res, 405, { error: 'Method not allowed.' });
      if (req.method === 'POST') {
        if (!allowedOrigin(req.headers.origin, req.headers.host, runtime))
          return json(res, 403, { error: 'Cross-origin writes are disabled.' });
        if (!req.headers['content-type']?.startsWith('application/json'))
          return json(res, 415, { error: 'Use application/json.' });
      }
      if (env.FORGE_API_ORIGIN) {
        const origin = backendOrigin(env.FORGE_API_ORIGIN, runtime);
        if (req.headers.host && new URL(origin).host === req.headers.host)
          throw new Error('FORGE_API_ORIGIN cannot point to this deployment.');
        const target = new URL(origin);
        target.pathname = url.pathname;
        target.search = url.search;
        const headers = new Headers();
        for (const name of ['authorization', 'content-type', 'origin']) {
          const value = req.headers[name];
          if (typeof value === 'string') headers.set(name, value);
        }
        let upstream: Response;
        try {
          upstream = await fetch(target, {
            method: req.method,
            headers,
            redirect: 'manual',
            ...(req.method === 'POST' ? { body: new Uint8Array(await proxyBody(req)) } : {}),
            signal: AbortSignal.timeout(55000),
          });
        } catch {
          return json(res, 502, {
            error:
              'The Forge backend could not be reached. Check FORGE_API_ORIGIN and the backend service.',
          });
        }
        // Never follow backend redirects with a wallet's Authorization header.
        if (upstream.status >= 300 && upstream.status < 400)
          return json(res, 502, {
            error: 'The Forge backend redirected the request. Set its final HTTPS origin.',
          });
        res.writeHead(upstream.status, {
          'Content-Type': upstream.headers.get('content-type') || 'application/json',
          'Cache-Control': upstream.headers.get('cache-control') || 'no-store',
        });
        res.end(req.method === 'HEAD' ? undefined : Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      if (path === '/api/config' && req.method === 'GET')
        return json(res, 200, {
          mode: 'live',
          balanceLabel: 'SOL',
          sdk: '2.0.0',
          liveTransactions: false,
          backendRequired: true,
        });
      if (path === '/healthz' && req.method === 'GET')
        return json(res, 200, { ok: true, mode: 'live', deployment: 'market-preview' });
      if (path === '/readyz' && req.method === 'GET')
        return json(res, 503, {
          launchEnabled: false,
          backendRequired: true,
          error: BACKEND_REQUIRED,
        });
      if (path === '/api/live/status' && req.method === 'GET') {
        const service = await getPreview(runtime);
        return json(res, 200, {
          ...(await service.chain.displayReads.get('status', 10000, () => service.chain.status())),
          backendRequired: true,
        });
      }
      if (readPaths.has(path) && req.method === 'GET') {
        const service = await getPreview(runtime);
        if (await service.handle(req, res, url)) return;
      }
      // Sessions, assets, quotes and transaction intents cannot live in ephemeral function storage.
      if (path.startsWith('/api/live/') && req.method === 'POST')
        return json(res, 503, { error: BACKEND_REQUIRED, code: 'PERSISTENT_BACKEND_REQUIRED' });
      return json(res, 404, { error: 'Route not found.' });
    } catch (error) {
      const status =
        error && typeof error === 'object' && 'status' in error ? Number(error.status) : 500;
      return json(res, status, {
        error: error instanceof Error ? error.message : 'The Forge API could not start.',
      });
    }
  };
}
