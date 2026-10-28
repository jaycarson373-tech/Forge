import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCoin,
  quote,
  execute,
  splitFee,
  units,
  NANO,
  GRADUATION,
  type PaperState,
} from '../src/domain.js';
const setup = () => {
  const c = makeCoin('Test', 'TEST', '', 'creator', 10);
  return { balance: String(10n * NANO), holdings: {}, coins: [c], trades: [] } as PaperState;
};
test('parses exact base units and rejects excess precision / exponent input', () => {
  assert.equal(units('0.000000001'), 1n);
  assert.equal(units('12.25', 6), 12250000n);
  assert.throws(() => units('0.0000000001'));
  assert.throws(() => units('1e3'));
  assert.throws(() => units('-1'));
});
test('launch slot 99% fee drops to 50 bps at the next slot', () => {
  const c = setup().coins[0];
  assert.equal(quote(c, 'buy', NANO, 10).fee, 990000000n);
  assert.equal(quote(c, 'buy', NANO, 11).fee, 5000000n);
  assert(quote(c, 'buy', NANO, 10).output < quote(c, 'buy', NANO, 11).output);
});
test('fee split conserves every base unit with deterministic dust', () => {
  for (const fee of [0n, 1n, 7n, 5000000n]) {
    const f = splitFee(fee);
    assert.equal(f.creator + f.protocol + f.platform, fee);
  }
  assert.deepEqual(splitFee(5000000n), {
    creator: 3000000n,
    protocol: 1000000n,
    platform: 1000000n,
  });
});
test('buy then full sell returns fewer SOL and restores zero real reserves', () => {
  const s = setup(),
    c = s.coins[0];
  execute(s, { coinId: c.id, side: 'buy', amount: String(NANO), minOut: '1', version: 0 }, 11);
  const held = s.holdings[c.id];
  assert(BigInt(held) > 0n);
  assert.equal(s.balance, String(9n * NANO));
  execute(s, { coinId: c.id, side: 'sell', amount: held, minOut: '1', version: 1 }, 12);
  assert.equal(s.holdings[c.id], '0');
  assert(BigInt(s.balance) < 10n * NANO);
  assert(BigInt(c.reserve) < 100n);
  assert.equal(s.trades.length, 2);
});
test('stale, overspend, slippage and malformed trades cannot mutate state', () => {
  for (const request of [
    { version: 2 },
    { amount: String(11n * NANO) },
    { minOut: String(10n ** 30n) },
    { amount: '-1' },
    { side: 'invalid' as 'buy' },
  ]) {
    const s = setup(),
      before = JSON.stringify(s);
    assert.throws(() =>
      execute(
        s,
        {
          coinId: s.coins[0].id,
          side: 'buy',
          amount: String(NANO),
          minOut: '1',
          version: 0,
          ...request,
        },
        11,
      ),
    );
    assert.equal(JSON.stringify(s), before);
  }
});
test('sell balance, zero-size and graduation boundaries are enforced', () => {
  const s = setup(),
    c = s.coins[0];
  assert.throws(() =>
    execute(s, { coinId: c.id, side: 'sell', amount: '1000', minOut: '1', version: 0 }, 11),
  );
  assert.throws(() => quote(c, 'buy', 0n, 11));
  assert.throws(() => quote(c, 'buy', 100n * NANO, 11));
  c.reserve = String(GRADUATION);
  assert.throws(() => quote(c, 'buy', NANO, 11));
});
test('launch inputs validate type, length, ticker and reward mode', () => {
  assert.throws(() => makeCoin('', 'AB'));
  assert.throws(() => makeCoin('Test', '<script>'));
  assert.throws(() => makeCoin('A', 'ABC', 'x'.repeat(501)));
  assert.throws(() => makeCoin('A', 'ABC', '', 'invalid' as 'creator'));
  assert.equal(makeCoin(' A ', 'abc').name, 'A');
});
test('virtual constant product does not decrease across many buys', () => {
  const s = setup(),
    c = s.coins[0];
  for (let i = 0; i < 25; i++) {
    const before = BigInt(c.virtualBase) * BigInt(c.virtualQuote);
    execute(
      s,
      { coinId: c.id, side: 'buy', amount: '1000000', minOut: '1', version: c.version },
      11,
    );
    assert(BigInt(c.virtualBase) * BigInt(c.virtualQuote) >= before);
  }
});
