import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Connection, SystemProgram, Transaction } from '@solana/web3.js';
import { LiveStore } from '../server/live-store.js';
import { LiveChain, rawAmount, slippage } from '../server/live-chain.js';
import { readRuntime, GENESIS, RateLimit } from '../server/runtime.js';
import { validImage } from '../server/live-http.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
test('wallet login is signature-bound, expiring, single-use and revocable', () => {
  const s = new LiveStore(':memory:');
  try {
    const wallet = Keypair.generate(),
      other = Keypair.generate();
    const c = s.challenge(wallet.publicKey.toBase58(), 'https://forge.example');
    const sign = (key: Keypair) =>
      Buffer.from(nacl.sign.detached(Buffer.from(c.message), key.secretKey)).toString('base64');
    assert.throws(() => s.authenticate(c.id, sign(other)), /signature/);
    const result = s.authenticate(c.id, sign(wallet));
    assert.equal(s.session(result.token), wallet.publicKey.toBase58());
    assert.throws(() => s.authenticate(c.id, sign(wallet)), /expired/);
    assert.equal(s.session('invalid'), null);
    s.logout(result.token);
    assert.equal(s.session(result.token), null);
    const expired = s.challenge(wallet.publicKey.toBase58(), 'https://forge.example');
    s.db.prepare('UPDATE auth_nonce SET expires=0 WHERE id=?').run(expired.id);
    assert.throws(() => s.authenticate(expired.id, sign(wallet)), /expired/);
  } finally {
    s.close();
  }
});
test('live runtime rejects unsafe production origins and gates mainnet explicitly', () => {
  assert.throws(
    () => readRuntime({ NODE_ENV: 'production', PUBLIC_URL: 'http://forge.example' }),
    /HTTPS/,
  );
  assert.throws(() => readRuntime({ PUBLIC_URL: 'https://forge.example/path' }), /origin/);
  assert.equal(readRuntime({}).mode, 'live');
  assert.throws(() => readRuntime({ SOLANA_CLUSTER: 'mainnet' }), /SOLANA_CLUSTER/);
  assert.throws(() => readRuntime({ APP_MODE: 'unknown' }), /APP_MODE/);
  assert.equal(readRuntime({}).transactionsEnabled, false);
  assert.equal(readRuntime({ SOLANA_CLUSTER: 'devnet' }).transactionsEnabled, true);
  assert.equal(readRuntime({ ENABLE_MAINNET_TRANSACTIONS: 'true' }).transactionsEnabled, true);
});
test('amount, slippage, image and request rate boundaries are enforced', () => {
  assert.throws(() => rawAmount('-1'));
  assert.throws(() => rawAmount('0'));
  assert.throws(() => rawAmount('18446744073709551616'));
  assert.throws(() => slippage(1001));
  assert.throws(() => slippage(1.1));
  assert.equal(slippage(100), 100);
  assert.throws(() => validImage('data:image/svg+xml;base64,PHN2Zz4='));
  assert.throws(() => validImage('data:image/png;base64,AAAAAAAAAAAA'));
  const limit = new RateLimit(2, 1000);
  assert.equal(limit.take('a', 100), true);
  assert.equal(limit.take('a', 100), true);
  assert.equal(limit.take('a', 100), false);
  assert.equal(limit.take('a', 1100), true);
});
function fixture() {
  const store = new LiveStore(':memory:'),
    wallet = Keypair.generate(),
    other = Keypair.generate();
  const connection = new Connection('https://api.devnet.solana.com');
  let broadcasts = 0;
  connection.getGenesisHash = async () => GENESIS.devnet;
  connection.getLatestBlockhash = async () => ({
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 1000,
  });
  connection.getBlockHeight = async () => 100;
  connection.simulateTransaction = (async () => ({
    context: { slot: 10 },
    value: { err: null, logs: [], unitsConsumed: 10000 },
  })) as typeof connection.simulateTransaction;
  connection.getFeeForMessage = async () => ({ context: { slot: 10 }, value: 10000 });
  connection.sendRawTransaction = async (raw) => {
    broadcasts++;
    return bs58.encode(Transaction.from(raw).signature!);
  };
  const chain = new LiveChain(readRuntime({ SOLANA_CLUSTER: 'devnet' }), store, connection);
  const tx = () =>
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: other.publicKey,
        lamports: 1,
      }),
    );
  return { store, wallet, other, connection, chain, tx, broadcasts: () => broadcasts };
}
test('only the exact simulated transaction with every required signature can be relayed', async () => {
  const f = fixture();
  try {
    const p = await f.chain.prepare(f.tx(), f.wallet.publicKey.toBase58(), { kind: 'test' });
    const tx = Transaction.from(Buffer.from(p.transaction, 'base64'));
    await assert.rejects(
      () =>
        f.chain.send(
          f.wallet.publicKey.toBase58(),
          p.id,
          tx.serialize({ requireAllSignatures: false }).toString('base64'),
        ),
      /missing signatures/,
    );
    const changed = Transaction.from(Buffer.from(p.transaction, 'base64'));
    changed.instructions[2].data[4] ^= 1;
    changed.sign(f.wallet);
    await assert.rejects(
      () =>
        f.chain.send(f.wallet.publicKey.toBase58(), p.id, changed.serialize().toString('base64')),
      /prepared intent/,
    );
    await assert.rejects(() => f.chain.send(f.other.publicKey.toBase58(), p.id, 'AA=='), /Unknown/);
    tx.sign(f.wallet);
    const raw = tx.serialize().toString('base64');
    const r = await f.chain.send(f.wallet.publicKey.toBase58(), p.id, raw);
    assert.equal(r.signature, bs58.encode(tx.signature!));
    await f.chain.send(f.wallet.publicKey.toBase58(), p.id, raw);
    assert.equal(f.broadcasts(), 1);
  } finally {
    f.store.close();
  }
});
test('failed simulation, expired intent and cluster mismatch never broadcast', async () => {
  const f = fixture();
  try {
    const p = await f.chain.prepare(f.tx(), f.wallet.publicKey.toBase58(), { kind: 'test' });
    const tx = Transaction.from(Buffer.from(p.transaction, 'base64'));
    tx.sign(f.wallet);
    f.store.db.prepare('UPDATE prepared_tx SET expires=0 WHERE id=?').run(p.id);
    await assert.rejects(
      () => f.chain.send(f.wallet.publicKey.toBase58(), p.id, tx.serialize().toString('base64')),
      /expired/,
    );
    f.connection.simulateTransaction = (async () => ({
      context: { slot: 10 },
      value: { err: { InstructionError: [0, 'InsufficientFunds'] }, logs: [] },
    })) as typeof f.connection.simulateTransaction;
    await assert.rejects(
      () => f.chain.prepare(f.tx(), f.wallet.publicKey.toBase58(), { kind: 'test' }),
      /Simulation failed/,
    );
    const bad = new LiveChain(
      readRuntime({ SOLANA_CLUSTER: 'mainnet-beta', ENABLE_MAINNET_TRANSACTIONS: 'true' }),
      f.store,
      f.connection,
    );
    await assert.rejects(() => bad.cluster(), /cluster/);
    assert.equal(f.broadcasts(), 0);
  } finally {
    f.store.close();
  }
});
test('RPC timeout preserves the signed transaction ID for recovery without constructing a duplicate', async () => {
  const f = fixture();
  try {
    const p = await f.chain.prepare(f.tx(), f.wallet.publicKey.toBase58(), {});
    const tx = Transaction.from(Buffer.from(p.transaction, 'base64'));
    tx.sign(f.wallet);
    f.connection.sendRawTransaction = async () => {
      throw new Error('Network timeout after possible acceptance');
    };
    const result = await f.chain.send(
      f.wallet.publicKey.toBase58(),
      p.id,
      tx.serialize().toString('base64'),
    );
    assert.equal(result.signature, bs58.encode(tx.signature!));
    assert('warning' in result);
    const saved = f.store.db.prepare('SELECT signature FROM prepared_tx WHERE id=?').get(p.id) as {
      signature: string;
    };
    assert.equal(saved.signature, result.signature);
  } finally {
    f.store.close();
  }
});
test('confirmation status distinguishes failed, confirmed, submitted and expired', async () => {
  const f = fixture();
  try {
    const p = await f.chain.prepare(f.tx(), f.wallet.publicKey.toBase58(), {});
    f.store.db.prepare('UPDATE prepared_tx SET signature=? WHERE id=?').run('test-signature', p.id);
    f.connection.getSignatureStatuses = (async () => ({
      context: { slot: 10 },
      value: [{ slot: 10, confirmations: 1, confirmationStatus: 'confirmed', err: null }],
    })) as typeof f.connection.getSignatureStatuses;
    assert.equal(
      (await f.chain.transaction(f.wallet.publicKey.toBase58(), p.id)).status,
      'confirmed',
    );
    f.connection.getSignatureStatuses = async () => ({ context: { slot: 10 }, value: [null] });
    assert.equal(
      (await f.chain.transaction(f.wallet.publicKey.toBase58(), p.id)).status,
      'submitted',
    );
    f.connection.getBlockHeight = async () => 1001;
    assert.equal(
      (await f.chain.transaction(f.wallet.publicKey.toBase58(), p.id)).status,
      'expired',
    );
  } finally {
    f.store.close();
  }
});
