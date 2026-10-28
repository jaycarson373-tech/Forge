/** Opt-in integration exercise. Uses an ephemeral keypair and free DEVNET SOL only. */
import { Keypair, Transaction } from '@solana/web3.js';
import { LiveStore } from '../server/live-store.js';
import { LiveChain } from '../server/live-chain.js';
import { readRuntime } from '../server/runtime.js';
import { readFileSync } from 'node:fs';
const wallet = process.env.DEVNET_KEYPAIR_PATH
    ? Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(readFileSync(process.env.DEVNET_KEYPAIR_PATH, 'utf8'))),
      )
    : Keypair.generate(),
  config = Keypair.generate(),
  mint = Keypair.generate(),
  store = new LiveStore(':memory:');
const chain = new LiveChain(
  readRuntime({
    SOLANA_CLUSTER: 'devnet',
    SOLANA_RPC_URL: process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com',
    PLATFORM_FEE_WALLET: wallet.publicKey.toBase58(),
    PUBLIC_URL: 'https://forge-devnet.invalid',
  }),
  store,
);
const address = wallet.publicKey.toBase58();
async function execute(prepared: Awaited<ReturnType<LiveChain['prepare']>>, extra?: Keypair) {
  const tx = Transaction.from(Buffer.from(prepared.transaction, 'base64'));
  tx.sign(...(extra ? [wallet, extra] : [wallet]));
  const sent = await chain.send(address, prepared.id, tx.serialize().toString('base64'));
  for (let i = 0; i < 60; i++) {
    const status = await chain.transaction(address, prepared.id);
    if (status.status === 'confirmed' || status.status === 'finalized') return sent.signature;
    if (status.status === 'failed' || status.status === 'expired')
      throw new Error(JSON.stringify(status));
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Devnet confirmation timeout.');
}
try {
  await chain.cluster();
  console.log('Devnet genesis verified. Test wallet:', address);
  if ((await chain.connection.getBalance(wallet.publicKey)) < 100000000) {
    console.log('Requesting free devnet test SOL.');
    const airdrop = await chain.connection.requestAirdrop(wallet.publicKey, 2_000_000_000);
    for (let i = 0; i < 60; i++) {
      const s = (await chain.connection.getSignatureStatuses([airdrop])).value[0];
      if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if ((await chain.connection.getBalance(wallet.publicKey)) < 100000000)
    throw new Error('Devnet faucet did not fund the test wallet.');
  console.log(
    'Config:',
    await execute(await chain.setup(address, config.publicKey.toBase58()), config),
  );
  await chain.register(address, config.publicKey.toBase58());
  const uri = chain.runtime.publicUrl + '/metadata/devnet-test.json';
  store.db
    .prepare('INSERT INTO live_coins VALUES(?,?,?,?,?,?,?,?)')
    .run(
      mint.publicKey.toBase58(),
      'Forge Devnet Test',
      'FORGETEST',
      'Ephemeral integration test. No monetary value.',
      '',
      uri,
      address,
      Date.now(),
    );
  console.log(
    'Launch:',
    await execute(
      await chain.launch(address, mint.publicKey.toBase58(), {
        name: 'Forge Devnet Test',
        ticker: 'FORGETEST',
        uri,
      }),
      mint,
    ),
  );
  await new Promise((r) => setTimeout(r, 1500));
  const buy = await chain.quote(mint.publicKey.toBase58(), 'buy', '10000000', 100);
  console.log(
    'Buy:',
    await execute(
      await chain.swap(address, {
        mint: mint.publicKey.toBase58(),
        side: 'buy',
        amount: buy.amountIn,
        minimumAmountOut: buy.minimumAmountOut,
        slippageBps: 100,
        quotedAt: buy.quotedAt,
      }),
    ),
  );
  const balance = await chain.balance(address),
    tokens = balance.tokens.find((t) => t.mint === mint.publicKey.toBase58());
  if (!tokens) throw new Error('Bought tokens not found.');
  const sell = await chain.quote(mint.publicKey.toBase58(), 'sell', tokens.amount, 100);
  console.log(
    'Sell:',
    await execute(
      await chain.swap(address, {
        mint: mint.publicKey.toBase58(),
        side: 'sell',
        amount: sell.amountIn,
        minimumAmountOut: sell.minimumAmountOut,
        slippageBps: 100,
        quotedAt: sell.quotedAt,
      }),
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      cluster: 'devnet',
      wallet: address,
      config: config.publicKey.toBase58(),
      mint: mint.publicKey.toBase58(),
      mainnetTransactions: 0,
      metadataReachabilityTested: false,
    }),
  );
} finally {
  store.close();
}
