import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';
import {
  DynamicBondingCurveClient,
  buildCurveWithMarketCap,
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  MigrationOption,
  MigrationFeeOption,
  TokenType,
  TokenDecimal,
  TokenAuthorityOption,
  MigratedCollectFeeMode,
  DammV2BaseFeeMode,
  DammV2DynamicFeeMode,
  type CreatePoolParams,
  type CreateConfig2Params,
  type SwapParams,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
export const DBC_PROGRAM = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
/** SOL policy reconstructed from the public DBC config; fee recipients are supplied by the operator. */
export function forgeCurve() {
  const config = buildCurveWithMarketCap({
    initialMarketCap: 28,
    migrationMarketCap: 410,
    activationType: ActivationType.Slot,
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: 9,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1e9,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: 9900,
          endingFeeBps: 50,
          numberOfPeriod: 1,
          totalDuration: 1,
        },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 75,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: true,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.Customizable,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: {
        collectFeeMode: MigratedCollectFeeMode.QuoteToken,
        dynamicFee: DammV2DynamicFeeMode.Disabled,
        poolFeeBps: 50,
        baseFeeMode: DammV2BaseFeeMode.FeeMarketCapSchedulerLinear,
        marketCapFeeSchedulerParams: {
          endingBaseFeeBps: 10,
          numberOfPeriod: 40,
          priceMultiple: 240,
          schedulerExpirationDuration: 5 * 365 * 86400,
        },
      },
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 50,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 50,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
  });
  // Preserve observed integer geometry rather than regenerate with a newer SDK's rounding.
  // Evidence: docs/mogz-chain-snapshot.json, config BpRX1s…uqSq, 2026-10-28.
  config.sqrtStartPrice = new BN('97610996050845795');
  config.curve = [
    {
      sqrtPrice: new BN('373518099210178542'),
      liquidity: new BN('104765727764124514852349615093579'),
    },
    {
      sqrtPrice: new BN('79226673521066979257578248091'),
      liquidity: new BN('3403781914328891540335427'),
    },
  ];
  return config;
}
/** Builds unsigned transactions only. No private keys, signing, or broadcast methods. */
export class MeteoraBuilder {
  readonly client: DynamicBondingCurveClient;
  constructor(readonly connection: Connection) {
    this.client = new DynamicBondingCurveClient(connection, 'confirmed');
  }
  async assertDevnet() {
    const hash = await this.connection.getGenesisHash();
    if (hash !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1')
      throw new Error('Transaction builders are restricted to Solana devnet.');
  }
  async createConfig(
    accounts: Pick<
      CreateConfig2Params,
      'payer' | 'config' | 'feeClaimer' | 'leftoverReceiver' | 'quoteMint'
    >,
  ) {
    await this.assertDevnet();
    return this.client.partner.createConfig2({ ...forgeCurve(), ...accounts });
  }
  async createPool(input: CreatePoolParams) {
    await this.assertDevnet();
    return this.client.creator.createPool(input);
  }
  async swap(input: SwapParams) {
    await this.assertDevnet();
    if (input.amountIn.lte(new BN(0)) || input.minimumAmountOut.lte(new BN(0)))
      throw new Error('Use positive input and a nonzero slippage-protected minimum output.');
    return this.client.pool.swap(input);
  }
  async exportUnsigned(tx: Transaction, payer: PublicKey) {
    await this.assertDevnet();
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed');
    tx.feePayer = payer;
    tx.recentBlockhash = blockhash;
    return {
      transaction: tx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString('base64'),
      lastValidBlockHeight,
      cluster: 'devnet',
      signed: false,
    };
  }
}
