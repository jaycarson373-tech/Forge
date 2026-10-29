import { PublicKey, Connection } from '@solana/web3.js';
export type Runtime = ReturnType<typeof readRuntime>;
export function readRuntime(env: NodeJS.ProcessEnv = process.env) {
  if (env.APP_MODE && !['live', 'paper'].includes(env.APP_MODE))
    throw new Error('APP_MODE must be live or paper.');
  if (env.SOLANA_CLUSTER && !['devnet', 'mainnet-beta'].includes(env.SOLANA_CLUSTER))
    throw new Error('SOLANA_CLUSTER must be devnet or mainnet-beta.');
  const mode = env.APP_MODE === 'paper' ? 'paper' : 'live';
  const cluster: 'devnet' | 'mainnet-beta' =
    env.SOLANA_CLUSTER === 'devnet' ? 'devnet' : 'mainnet-beta';
  const publicUrl = env.PUBLIC_URL || 'http://127.0.0.1:8787';
  const parsed = new URL(publicUrl);
  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password)
    throw new Error('PUBLIC_URL must be an origin, without a path or credentials.');
  if (env.NODE_ENV === 'production' && parsed.protocol !== 'https:')
    throw new Error('Production PUBLIC_URL must use HTTPS.');
  const feeWallet = env.PLATFORM_FEE_WALLET || '';
  if (feeWallet) new PublicKey(feeWallet);
  const configAddress = env.DBC_CONFIG_ADDRESS || '';
  if (configAddress) new PublicKey(configAddress);
  const rpcUrl = env.SOLANA_RPC_URL || `https://api.${cluster}.solana.com`;
  const rpc = new URL(rpcUrl);
  if (!['http:', 'https:'].includes(rpc.protocol)) throw new Error('Invalid RPC protocol.');
  if (env.NODE_ENV === 'production' && rpc.protocol !== 'https:')
    throw new Error('Production RPC must use HTTPS.');
  const transactionsEnabled = cluster === 'devnet' || env.ENABLE_MAINNET_TRANSACTIONS === 'true';
  return {
    mode,
    cluster,
    publicUrl: parsed.origin,
    feeWallet,
    configAddress,
    rpcUrl,
    transactionsEnabled,
    production: env.NODE_ENV === 'production',
    dataPath: env.DATA_PATH || 'data/forge.sqlite',
  };
}
export const GENESIS = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
} as const;
export function allowedOrigin(
  origin: string | undefined,
  host: string | undefined,
  runtime: Pick<Runtime, 'production' | 'publicUrl'>,
) {
  if (!origin) return true;
  if (origin === runtime.publicUrl) return true;
  if (runtime.production) return false;
  try {
    const incoming = new URL(origin),
      configured = new URL(runtime.publicUrl);
    if (!['http:', 'https:'].includes(incoming.protocol)) return false;
    if (incoming.host === host) return true;
    const local = (h: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(h);
    return (
      local(incoming.hostname) &&
      local(configured.hostname) &&
      incoming.port === configured.port &&
      incoming.protocol === configured.protocol
    );
  } catch {
    return false;
  }
}
export function rpcConnection(url: string) {
  return new Connection(url, {
    commitment: 'confirmed',
    disableRetryOnRateLimit: true,
    fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) }),
  });
}
export class RateLimit {
  private buckets = new Map<string, { count: number; expires: number }>();
  constructor(
    private max = 120,
    private windowMs = 60000,
  ) {}
  take(key: string, now = Date.now()) {
    if (this.buckets.size > 10000) {
      for (const [k, v] of this.buckets) if (v.expires <= now) this.buckets.delete(k);
      if (this.buckets.size > 10000) throw new Error('Server is busy.');
    }
    let b = this.buckets.get(key);
    if (!b || b.expires <= now) {
      b = { count: 0, expires: now + this.windowMs };
      this.buckets.set(key, b);
    }
    if (++b.count > this.max) return false;
    return true;
  }
}
