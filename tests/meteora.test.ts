import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forgeCurve, MeteoraBuilder } from '../server/meteora.js';
import { Connection } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { chainJSON } from '../server/inspect.js';
test('Meteora SDK builds the intended curve, fee schedule and locked-liquidity policy', () => {
  const c = forgeCurve();
  assert.equal(c.activationType, 0);
  assert.equal(c.tokenDecimal, 6);
  assert.equal(c.creatorTradingFeePercentage, 75);
  assert.equal(c.migrationOption, 1);
  assert.equal(c.partnerPermanentLockedLiquidityPercentage, 50);
  assert.equal(c.creatorPermanentLockedLiquidityPercentage, 50);
  assert.equal(c.partnerLiquidityPercentage, 0);
  assert.equal(c.creatorLiquidityPercentage, 0);
  assert.equal(c.poolFees.baseFee.cliffFeeNumerator.toString(), '990000000');
  assert(c.curve.length > 0);
});
test('transaction builder refuses a mainnet genesis hash', async () => {
  const connection = new Connection('https://api.mainnet-beta.solana.com');
  connection.getGenesisHash = async () => '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
  await assert.rejects(() => new MeteoraBuilder(connection).assertDevnet(), /restricted/);
});
test('reconstructed geometry and fee schedule match the decoded on-chain snapshot', () => {
  const observed = JSON.parse(
    readFileSync(new URL('../docs/mogz-chain-snapshot.json', import.meta.url), 'utf8'),
  ).dbc.config;
  const built = forgeCurve();
  assert.deepEqual(
    chainJSON(built.curve),
    observed.curve.filter((p: { liquidity: string }) => p.liquidity !== '0'),
  );
  assert.equal(built.sqrtStartPrice.toString(), observed.sqrtStartPrice);
  assert.equal(built.migrationQuoteThreshold.toString(), observed.migrationQuoteThreshold);
  const fee = built.poolFees.baseFee;
  for (const key of ['cliffFeeNumerator', 'secondFactor', 'thirdFactor'] as const)
    assert.equal(fee[key].toString(), observed.poolFees.baseFee[key]);
  assert.equal(fee.firstFactor, observed.poolFees.baseFee.firstFactor);
  assert.equal(fee.baseFeeMode, observed.poolFees.baseFee.baseFeeMode);
  for (const key of [
    'activationType',
    'migrationOption',
    'creatorTradingFeePercentage',
    'partnerPermanentLockedLiquidityPercentage',
    'creatorPermanentLockedLiquidityPercentage',
  ] as const)
    assert.equal(built[key], observed[key]);
});
