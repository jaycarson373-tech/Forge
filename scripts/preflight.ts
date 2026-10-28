import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { readRuntime } from '../server/runtime.js';
import { LiveStore } from '../server/live-store.js';
import { LiveChain } from '../server/live-chain.js';
if (existsSync('.env')) loadEnvFile('.env');
const runtime = readRuntime(),
  store = new LiveStore(runtime.dataPath);
try {
  const chain = new LiveChain(runtime, store);
  const status = await chain.status();
  const checks = {
    https: runtime.publicUrl.startsWith('https://'),
    feeWalletConfigured: !!runtime.feeWallet,
    rpcClusterVerified: status.rpcReady,
    partnerConfigVerified: status.configReady,
    liveMode: runtime.mode === 'live',
    mainnetExplicitlyEnabled: runtime.transactionsEnabled,
  };
  console.log(
    JSON.stringify(
      {
        cluster: runtime.cluster,
        checks,
        ready: Object.values(checks).every(Boolean),
        message: status.error || null,
      },
      null,
      2,
    ),
  );
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
} finally {
  store.close();
}
