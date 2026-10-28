import { LiveChain } from '../server/live-chain.js';
import { LiveStore } from '../server/live-store.js';
import { readRuntime } from '../server/runtime.js';
import { Keypair } from '@solana/web3.js';
const store = new LiveStore(':memory:');
try {
  const chain = new LiveChain(readRuntime(), store);
  const mint = process.argv[2] || 'Pmfm2RprxQRKZH1XWVsBUc2KgCTyzeDTSFbT1vJmogz';
  const market = await chain.market(mint);
  const quote = await chain.quote(mint, 'buy', '10000000', 100);
  let simulations: unknown = null;
  if (process.env.SIMULATION_WALLET) {
    const simulator = new LiveChain(
      readRuntime({ ...process.env, ENABLE_MAINNET_TRANSACTIONS: 'true' }),
      store,
    );
    const simulated = await simulator.swap(process.env.SIMULATION_WALLET, {
      mint,
      side: 'buy',
      amount: quote.amountIn,
      minimumAmountOut: quote.minimumAmountOut,
      slippageBps: 100,
      quotedAt: quote.quotedAt,
    });
    const summary = (p: Awaited<ReturnType<LiveChain['prepare']>>) => ({
      simulation: p.simulation,
      intent: p.intent,
      networkFee: p.networkFee,
    });
    simulations = { swap: summary(simulated) };
    if (process.env.SIMULATE_LAUNCH === 'true') {
      const publicWallet = process.env.SIMULATION_WALLET;
      const setupSimulator = new LiveChain(
        readRuntime({
          ...process.env,
          DBC_CONFIG_ADDRESS: '',
          PLATFORM_FEE_WALLET: publicWallet,
          ENABLE_MAINNET_TRANSACTIONS: 'true',
        }),
        store,
      );
      const setup = await setupSimulator.setup(
        publicWallet,
        Keypair.generate().publicKey.toBase58(),
      );
      const source = await chain.pool(mint),
        testMint = Keypair.generate().publicKey.toBase58();
      const launchSimulator = new LiveChain(
        readRuntime({
          ...process.env,
          DBC_CONFIG_ADDRESS: market.config,
          PLATFORM_FEE_WALLET: source.config.feeClaimer.toBase58(),
          ENABLE_MAINNET_TRANSACTIONS: 'true',
        }),
        store,
      );
      const uri = launchSimulator.runtime.publicUrl + '/metadata/unsigned-simulation.json';
      store.db
        .prepare('INSERT INTO live_coins VALUES(?,?,?,?,?,?,?,?)')
        .run(
          testMint,
          'Unsigned Simulation',
          'SIMTEST',
          'Not minted or broadcast.',
          '',
          uri,
          publicWallet,
          Date.now(),
        );
      const launch = await launchSimulator.launch(publicWallet, testMint, {
        name: 'Unsigned Simulation',
        ticker: 'SIMTEST',
        uri,
      });
      simulations = { swap: summary(simulated), setup: summary(setup), launch: summary(launch) };
    }
  }
  console.log(
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        market,
        quote,
        simulations,
        signed: false,
        broadcast: false,
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}
