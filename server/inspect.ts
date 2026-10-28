import { Connection, PublicKey } from '@solana/web3.js';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import BN from 'bn.js';
export function chainJSON(value: unknown): unknown {
  if (BN.isBN(value)) return value.toString(10);
  if (value instanceof PublicKey) return value.toBase58();
  if (Array.isArray(value)) return value.map(chainJSON);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, chainJSON(v)]));
  return value;
}
export const TARGET = 'Pmfm2RprxQRKZH1XWVsBUc2KgCTyzeDTSFbT1vJmogz';
export async function inspectMint(
  address: string,
  rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
) {
  const mint = new PublicKey(address);
  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    disableRetryOnRateLimit: true,
    fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }),
  });
  const account = await connection.getParsedAccountInfo(mint);
  if (
    !account.value ||
    !('parsed' in account.value.data) ||
    account.value.data.parsed.type !== 'mint'
  )
    throw new Error('Address is not a parsed SPL mint account on this cluster.');
  const info = account.value.data.parsed.info;
  const client = new DynamicBondingCurveClient(connection, 'confirmed');
  let dbc: unknown = null;
  let dbcError: string | null = null;
  try {
    const result = await client.state.getPoolByBaseMint(mint);
    if (result) {
      const pool = result.account.poolState;
      const config = await client.state.getPoolConfig(pool.config);
      dbc = {
        address: result.publicKey.toBase58(),
        pool,
        configAddress: pool.config.toBase58(),
        config,
      };
    }
  } catch (error) {
    dbcError = error instanceof Error ? error.message : 'DBC read failed';
  }
  return {
    address,
    scannedAt: new Date().toISOString(),
    mintReadSlot: account.context.slot,
    rpc: new URL(rpcUrl).hostname,
    owner: account.value.owner.toBase58(),
    mint: info,
    dbc: chainJSON(dbc),
    dbcError,
  };
}
