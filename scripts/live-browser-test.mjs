/** UI integration fixture: real Ed25519 signatures, mocked chain responses, ZERO broadcasts. */
import { chromium } from 'playwright';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const wallet = Keypair.generate(),
  mint = Keypair.generate().publicKey.toBase58(),
  config = Keypair.generate().publicKey.toBase58(),
  pool = Keypair.generate().publicKey.toBase58();
const temp = await mkdtemp(join(tmpdir(), 'forge-live-ui-'));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env,
    APP_MODE: 'live',
    SOLANA_CLUSTER: 'devnet',
    PUBLIC_URL: 'http://127.0.0.1:18789',
    PORT: '18789',
    DATA_PATH: join(temp, 'test.sqlite'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
const market = {
  mint,
  pool,
  executionPool: pool,
  creator: wallet.publicKey.toBase58(),
  name: 'Live Test Coin',
  ticker: 'TEST',
  description: 'Isolated browser fixture. No real pool or funds.',
  image: '',
  price: 0.000001,
  marketCap: 1000,
  decimals: 6,
  progress: 0.5,
  route: 'dbc',
  ownConfig: true,
  creatorFees: '1000000',
  platformFees: '1000000',
  observedAt: Date.now(),
};
let verifiedSignatures = 0;
const intents = new Map();
function prepared(kind, input) {
  const tx = new Transaction({
    feePayer: wallet.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  });
  if (kind === 'launch')
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: new PublicKey(input.mint),
        lamports: 1,
        space: 0,
        programId: SystemProgram.programId,
      }),
    );
  else
    tx.add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(mint),
        lamports: 1,
      }),
    );
  const id = String(intents.size + 1),
    hash = createHash('sha256').update(tx.serializeMessage()).digest('hex');
  intents.set(id, { hash, kind });
  return {
    id,
    transaction: tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64'),
    messageHash: hash,
    cluster: 'devnet',
    expiresAt: Date.now() + 60000,
    networkFee: '5000',
    simulation: { units: 1000 },
    intent: { kind, ...input },
  };
}
try {
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Startup timeout')), 15000);
    server.stdout.on('data', (b) => {
      if (b.toString().includes('Forge →')) {
        clearTimeout(t);
        resolve();
      }
    });
    server.once('error', reject);
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.exposeFunction('fixtureSign', (message) =>
    Array.from(nacl.sign.detached(Uint8Array.from(message), wallet.secretKey)),
  );
  await page.addInitScript((address) => {
    window.phantom = {
      solana: {
        connect: async () => ({ publicKey: { toBase58: () => address } }),
        signMessage: async (bytes) => ({
          signature: Uint8Array.from(await window.fixtureSign(Array.from(bytes))),
        }),
        signTransaction: async (tx) => {
          tx.addSignature(
            tx.feePayer,
            Uint8Array.from(await window.fixtureSign(Array.from(tx.serializeMessage()))),
          );
          return tx;
        },
      },
    };
  }, wallet.publicKey.toBase58());
  await page.route('**/api/live/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.split('/api/live/')[1];
    if (path.startsWith('auth/')) return route.continue();
    const input = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
    let data;
    switch (path) {
      case 'status':
        data = {
          cluster: 'devnet',
          publicUrl: 'http://127.0.0.1:18789',
          feeWallet: wallet.publicKey.toBase58(),
          configAddress: config,
          transactionsEnabled: true,
          rpcReady: true,
          configReady: true,
          launchEnabled: true,
          error: '',
        };
        break;
      case 'markets':
        data = [market];
        break;
      case 'market':
        data = market;
        break;
      case 'balance':
        data = {
          sol: '2000000000',
          tokens: [{ mint, amount: '1000000000', decimals: 6 }],
          signatures: [],
        };
        break;
      case 'quote':
        data = {
          amountIn: input.amount,
          amountOut: input.side === 'buy' ? '1000000' : '10000000',
          minimumAmountOut: input.side === 'buy' ? '990000' : '9900000',
          slippageBps: input.slippageBps,
          route: 'dbc',
          quotedAt: Date.now(),
          expiresAt: Date.now() + 20000,
        };
        break;
      case 'positions':
        data = [{ position: pool, pool }];
        break;
      case 'swap':
        data = prepared('swap', { ...input, amountIn: input.amount });
        break;
      case 'claim':
        data = prepared('claim', input);
        break;
      case 'claim-position':
        data = prepared('claim-position', input);
        break;
      case 'metadata':
        data = {
          uri: 'http://127.0.0.1:18789/metadata/test.json',
          name: input.name,
          ticker: input.ticker,
        };
        break;
      case 'launch':
        data = prepared('launch', input);
        break;
      case 'send': {
        const tx = Transaction.from(Buffer.from(input.transaction, 'base64')),
          expected = intents.get(input.id);
        if (
          !expected ||
          !tx.verifySignatures() ||
          createHash('sha256').update(tx.serializeMessage()).digest('hex') !== expected.hash
        )
          throw new Error('Fixture received invalid wallet/account signatures');
        verifiedSignatures++;
        data = { signature: bs58.encode(tx.signature) };
        break;
      }
      case 'transaction':
        data = { status: 'confirmed', signature: 'browser-fixture-signature' };
        break;
      default:
        throw new Error('Unexpected live fixture route ' + path);
    }
    await route.fulfill({ json: data });
  });
  await page.goto('http://127.0.0.1:18789');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('button', { name: 'Live Test Coin' }).click();
  await page.getByRole('button', { name: 'Review buy' }).click();
  await page.getByRole('heading', { name: 'Devnet transaction.' }).waitFor();
  await page.getByRole('button', { name: 'Sign and send with wallet' }).click();
  await page.getByRole('status').filter({ hasText: 'Transaction confirmed.' }).waitFor();
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  await page.getByRole('button', { name: 'Review sell' }).click();
  await page.getByRole('button', { name: 'Sign and send with wallet' }).click();
  await page.getByRole('status').filter({ hasText: 'Transaction confirmed.' }).waitFor();
  await page.getByRole('button', { name: 'Creator fees' }).click();
  await page.getByRole('button', { name: 'Creator ↗', exact: true }).click();
  await page.getByRole('button', { name: 'Sign and send with wallet' }).click();
  await page.getByRole('status').filter({ hasText: 'Transaction confirmed.' }).waitFor();
  await page.getByRole('button', { name: 'Review position claim' }).click();
  await page.getByRole('button', { name: 'Sign and send with wallet' }).click();
  await page.getByRole('status').filter({ hasText: 'Transaction confirmed.' }).waitFor();
  await page.getByRole('button', { name: 'Launch a coin' }).first().click();
  await page.getByLabel('Coin name').fill('Browser Launch');
  await page.getByLabel('Ticker', { exact: true }).fill('BROWSER');
  await page.getByLabel('Description', { exact: true }).fill('Fixture launch');
  await page.getByLabel('Image (PNG/JPEG, max 1 MB)').setInputFiles({
    name: 'coin.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.getByRole('button', { name: 'Review live launch' }).click();
  await page.getByRole('button', { name: 'Sign and send with wallet' }).click();
  await page.getByRole('status').filter({ hasText: 'Transaction confirmed.' }).waitFor();
  await page.waitForTimeout(300);
  if (verifiedSignatures !== 5)
    throw new Error(`Expected five signed fixture transactions, received ${verifiedSignatures}`);
  await page.getByRole('button', { name: '◈ Discover', exact: true }).click();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/live-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/live-mobile.png', fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw new Error('Mobile overflow');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    JSON.stringify({
      passed: true,
      verifiedFixtureTransactions: verifiedSignatures,
      flows: [
        'sign-in',
        'buy',
        'sell',
        'creator claim',
        'position claim',
        'launch with mint signer',
      ],
      realBroadcasts: 0,
      pageErrors: errors.length,
    }),
  );
} finally {
  await browser?.close();
  server.kill();
  await new Promise((resolve) => {
    if (server.exitCode !== null) resolve();
    else server.once('exit', resolve);
  });
  await rm(temp, { recursive: true, force: true });
}
