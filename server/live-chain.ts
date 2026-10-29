import {
  PublicKey,
  Transaction,
  VersionedTransaction,
  ComputeBudgetProgram,
  type Connection,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, NATIVE_MINT, getMint } from '@solana/spl-token';
import {
  DynamicBondingCurveClient,
  getCurrentPoint,
  getPriceFromSqrtPrice,
  deriveDammV2PoolAddress,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  type PoolConfig,
  type VirtualPool,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import BN from 'bn.js';
import bs58 from 'bs58';
import { randomUUID } from 'node:crypto';
import { forgeCurve } from './meteora.js';
import { GENESIS, type Runtime, rpcConnection } from './runtime.js';
import { LiveStore, hash } from './live-store.js';
import { chainJSON } from './inspect.js';
import { ReadCache } from './read-cache.js';
export const asKey = (value: unknown) => {
  if (typeof value !== 'string') throw new Error('Public address required.');
  return new PublicKey(value);
};
export function rawAmount(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^\d{1,20}$/.test(value) ||
    BigInt(value) <= 0n ||
    BigInt(value) > 18446744073709551615n
  )
    throw new Error('Invalid token amount.');
  return new BN(value);
}
export function slippage(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1000)
    throw new Error('Slippage must be 0–1000 basis points.');
  return value;
}
type StoredCoin = {
  mint: string;
  name: string;
  ticker: string;
  description: string;
  image: string;
  uri: string;
  creator: string;
  created: number;
};
type Pending = {
  id: string;
  wallet: string;
  message_hash: string;
  raw: string;
  height: number;
  expires: number;
  intent: string;
  signature: string | null;
};
export class LiveChain {
  connection: Connection;
  dbc: DynamicBondingCurveClient;
  cp: CpAmm;
  private verifiedAt = 0;
  private marketCache: { at: number; coins: unknown[] } | null = null;
  readonly displayReads = new ReadCache();
  private poolAddresses = new Map<string, PublicKey>();
  private quotes = new Map<
    string,
    {
      mint: string;
      side: 'buy' | 'sell';
      amountIn: string;
      minimumAmountOut: string;
      slippageBps: number;
      expiresAt: number;
    }
  >();
  constructor(
    readonly runtime: Runtime,
    readonly store: LiveStore,
    connection?: Connection,
  ) {
    this.connection = connection || rpcConnection(runtime.rpcUrl);
    this.dbc = new DynamicBondingCurveClient(this.connection, 'confirmed');
    this.cp = new CpAmm(this.connection);
  }
  get configAddress() {
    return this.runtime.configAddress || this.store.setting(`dbc-config:${this.runtime.cluster}`);
  }
  async cluster() {
    if (Date.now() - this.verifiedAt < 30000) return;
    const actual = await this.connection.getGenesisHash();
    if (actual !== GENESIS[this.runtime.cluster])
      throw new Error('RPC cluster does not match SOLANA_CLUSTER.');
    this.verifiedAt = Date.now();
  }
  async enabled() {
    if (!this.runtime.transactionsEnabled)
      throw new Error(
        'Mainnet transactions are disabled. Set ENABLE_MAINNET_TRANSACTIONS=true after deployment checks.',
      );
    await this.cluster();
  }
  validateConfig(config: PoolConfig | null) {
    if (!config) throw new Error('Partner config not found.');
    const template = forgeCurve();
    if (
      !this.runtime.feeWallet ||
      !config.feeClaimer.equals(asKey(this.runtime.feeWallet)) ||
      !config.leftoverReceiver.equals(asKey(this.runtime.feeWallet))
    )
      throw new Error('Partner config fee recipients do not match PLATFORM_FEE_WALLET.');
    if (
      !config.quoteMint.equals(NATIVE_MINT) ||
      config.tokenType !== 0 ||
      config.tokenDecimal !== 6 ||
      config.migrationOption !== 1 ||
      config.migrationFeeOption !== template.migrationFeeOption ||
      config.creatorTradingFeePercentage !== 75 ||
      config.partnerLiquidityPercentage !== 0 ||
      config.creatorLiquidityPercentage !== 0 ||
      config.partnerPermanentLockedLiquidityPercentage !== 50 ||
      config.creatorPermanentLockedLiquidityPercentage !== 50 ||
      config.tokenUpdateAuthority !== 1 ||
      config.fixedTokenSupplyFlag !== 1 ||
      config.quoteTokenFlag !== 0 ||
      !config.preMigrationTokenSupply.eq(new BN('1000000000000000')) ||
      !config.postMigrationTokenSupply.eq(new BN('1000000000000000')) ||
      config.migratedPoolFeeBps !== 50 ||
      config.migratedPoolBaseFeeMode !== 3 ||
      config.migratedCollectFeeMode !== 0 ||
      config.migratedDynamicFee !== 0 ||
      config.enableFirstSwapWithMinFee !== 1
    )
      throw new Error('Partner config differs from the supported SOL launch policy.');
    const fee = config.poolFees.baseFee,
      expected = template.poolFees.baseFee;
    if (
      fee.baseFeeMode !== expected.baseFeeMode ||
      fee.firstFactor !== expected.firstFactor ||
      !fee.cliffFeeNumerator.eq(expected.cliffFeeNumerator) ||
      !fee.secondFactor.eq(expected.secondFactor) ||
      !fee.thirdFactor.eq(expected.thirdFactor) ||
      config.poolFees.dynamicFee.initialized !== 0 ||
      config.collectFeeMode !== 0 ||
      !config.migrationQuoteThreshold.eq(template.migrationQuoteThreshold) ||
      !config.sqrtStartPrice.eq(template.sqrtStartPrice) ||
      config.migrationFeePercentage !== 0 ||
      config.poolCreationFee.gt(new BN(0))
    )
      throw new Error('Partner config fee or curve policy mismatch.');
    for (let i = 0; i < template.curve.length; i++)
      if (
        !config.curve[i]?.sqrtPrice.eq(template.curve[i].sqrtPrice) ||
        !config.curve[i]?.liquidity.eq(template.curve[i].liquidity)
      )
        throw new Error('Partner config curve segment mismatch.');
    if (
      config.curve
        .slice(template.curve.length)
        .some((p) => !p.liquidity.isZero() || !p.sqrtPrice.isZero())
    )
      throw new Error('Unexpected extra curve segments.');
    const scheduler = template.migratedPoolMarketCapFeeSchedulerParams,
      bytes = Buffer.alloc(16);
    bytes.writeUInt16LE(scheduler.numberOfPeriod, 0);
    bytes.writeUInt16LE(scheduler.sqrtPriceStepBps, 2);
    bytes.writeUInt32LE(scheduler.schedulerExpirationDuration, 4);
    scheduler.reductionFactor.toArrayLike(Buffer, 'le', 8).copy(bytes, 8);
    if (!Buffer.from(config.migratedPoolBaseFeeBytes).equals(bytes))
      throw new Error('Graduated fee scheduler does not match Forge policy.');
    return config;
  }
  async configured() {
    await this.cluster();
    if (!this.configAddress)
      throw new Error('Create or register your Forge partner config in Settings first.');
    return this.validateConfig(await this.dbc.state.getPoolConfig(asKey(this.configAddress)));
  }
  async status() {
    let rpcReady = false,
      configReady = false,
      error = '';
    try {
      await this.cluster();
      rpcReady = true;
      if (this.configAddress) {
        await this.configured();
        configReady = true;
      }
    } catch (e) {
      error = (e as Error).message;
    }
    return {
      mode: 'live',
      cluster: this.runtime.cluster,
      publicUrl: this.runtime.publicUrl,
      feeWallet: this.runtime.feeWallet,
      configAddress: this.configAddress,
      transactionsEnabled: this.runtime.transactionsEnabled,
      rpcReady,
      configReady,
      error,
      launchEnabled: rpcReady && configReady && this.runtime.transactionsEnabled,
    };
  }
  async pool(mint: string) {
    const key = asKey(mint);
    const known = this.poolAddresses.get(mint);
    let found = known ? { publicKey: known, account: await this.dbc.state.getPool(known) } : null;
    if (!found?.account) found = await this.dbc.state.getPoolByBaseMint(key);
    if (!found?.account) throw new Error('No Meteora DBC launch pool found for this mint.');
    const pool = found.account.poolState;
    if (!pool.baseMint.equals(key))
      throw new Error('Pool mint does not match the requested market.');
    if (this.poolAddresses.size >= 128)
      this.poolAddresses.delete(this.poolAddresses.keys().next().value!);
    this.poolAddresses.set(mint, found.publicKey);
    const config = await this.dbc.state.getPoolConfig(pool.config);
    if (!config || !config.quoteMint.equals(NATIVE_MINT) || config.tokenType !== 0)
      throw new Error('Only classic SPL tokens paired with SOL are supported.');
    return { address: found.publicKey, pool, config };
  }
  async migrated(mint: PublicKey, config: PoolConfig) {
    const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption];
    if (!dammConfig) throw new Error('Unsupported migration config.');
    const publicKey = deriveDammV2PoolAddress(dammConfig, mint, NATIVE_MINT);
    const account = await this.cp.fetchPoolState(publicKey);
    if (!account.tokenAMint.equals(mint) || !account.tokenBMint.equals(NATIVE_MINT))
      throw new Error('Migrated pool token mismatch.');
    return { publicKey, account };
  }
  async market(
    mint: string,
    loaded?: { address: PublicKey; pool: VirtualPool['poolState']; config: PoolConfig },
  ) {
    await this.cluster();
    const { address, pool, config } = loaded || (await this.pool(mint));
    const metadata = this.store.db.prepare('SELECT * FROM live_coins WHERE mint=?').get(mint) as
      StoredCoin | undefined;
    let price = Number(getPriceFromSqrtPrice(pool.sqrtPrice, config.tokenDecimal, 9).toString()),
      route = 'dbc',
      executionPool = address.toBase58();
    if (pool.isMigrated) {
      const p = await this.migrated(asKey(mint), config);
      price =
        (Number(p.account.sqrtPrice.toString()) / 2 ** 64) ** 2 * 10 ** (config.tokenDecimal - 9);
      route = 'damm-v2';
      executionPool = p.publicKey.toBase58();
    }
    return {
      mint,
      pool: address.toBase58(),
      executionPool,
      config: pool.config.toBase58(),
      creator: pool.creator.toBase58(),
      name:
        metadata?.name ||
        (mint === 'Pmfm2RprxQRKZH1XWVsBUc2KgCTyzeDTSFbT1vJmogz'
          ? 'Mogz.fun'
          : `Token ${mint.slice(0, 6)}`),
      ticker:
        metadata?.ticker ||
        (mint === 'Pmfm2RprxQRKZH1XWVsBUc2KgCTyzeDTSFbT1vJmogz' ? 'MOGZ' : mint.slice(0, 5)),
      description: metadata?.description || '',
      image: metadata?.image || '',
      uri: metadata?.uri || '',
      price,
      marketCap:
        (price * Number(config.postMigrationTokenSupply.toString())) / 10 ** config.tokenDecimal,
      decimals: config.tokenDecimal,
      progress: Math.min(
        1,
        Number(pool.quoteReserve.toString()) / Number(config.migrationQuoteThreshold.toString()),
      ),
      route,
      ownConfig: pool.config.toBase58() === this.configAddress,
      creatorFees: pool.creatorQuoteFee.toString(),
      platformFees: pool.partnerQuoteFee.toString(),
      metrics: chainJSON(pool.metrics),
      observedAt: Date.now(),
    };
  }
  async markets() {
    await this.cluster();
    if (!this.configAddress) return [];
    if (this.marketCache && Date.now() - this.marketCache.at < 15000) return this.marketCache.coins;
    const config = await this.configured();
    const pools = await this.dbc.state.getPoolsByConfig(asKey(this.configAddress));
    const result = [];
    for (const p of pools.slice(-100).reverse()) {
      try {
        result.push(
          await this.market(p.account.poolState.baseMint.toBase58(), {
            address: p.publicKey,
            pool: p.account.poolState,
            config,
          }),
        );
      } catch {
        /* A transient or pending migration is surfaced in the individual market. */
      }
    }
    this.marketCache = { at: Date.now(), coins: result };
    return result;
  }
  async balance(wallet: string) {
    await this.cluster();
    const owner = asKey(wallet);
    const [balance, accounts, signatures] = await Promise.all([
      this.connection.getBalance(owner),
      this.connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
      this.connection.getSignaturesForAddress(owner, { limit: 15 }),
    ]);
    return {
      wallet,
      sol: String(balance),
      tokens: accounts.value
        .map((a) => ({
          mint: a.account.data.parsed.info.mint,
          amount: a.account.data.parsed.info.tokenAmount.amount,
          decimals: a.account.data.parsed.info.tokenAmount.decimals,
        }))
        .filter((t) => BigInt(t.amount) > 0n),
      signatures: signatures.map((s) => ({
        signature: s.signature,
        time: s.blockTime,
        error: s.err,
      })),
    };
  }
  async quote(mint: string, side: 'buy' | 'sell', amount: string, bps: number) {
    await this.cluster();
    const input = rawAmount(amount);
    slippage(bps);
    if (side !== 'buy' && side !== 'sell') throw new Error('Invalid trade side.');
    const { address, pool, config } = await this.pool(mint);
    let out: BN,
      min: BN,
      fee: BN,
      route: 'dbc' | 'damm-v2' = 'dbc',
      executionPool = address;
    if (pool.isMigrated) {
      route = 'damm-v2';
      const p = await this.migrated(asKey(mint), config);
      executionPool = p.publicKey;
      const slot = await this.connection.getSlot();
      const time = await this.connection.getBlockTime(slot);
      if (time === null) throw new Error('Chain clock unavailable. Retry.');
      const q = this.cp.getQuote({
        inAmount: input,
        inputTokenMint: side === 'buy' ? NATIVE_MINT : asKey(mint),
        slippage: 0,
        poolState: p.account,
        currentSlot: slot,
        currentTime: time,
        tokenADecimal: config.tokenDecimal,
        tokenBDecimal: 9,
        hasReferral: false,
      });
      if (!q.consumedInAmount.eq(input))
        throw new Error('Only full exact-input swaps are supported.');
      out = q.swapOutAmount;
      min = out.muln(10000 - bps).divn(10000);
      fee = q.totalFee;
    } else {
      const point = await getCurrentPoint(this.connection, config.activationType);
      if (point.lte(pool.activationPoint))
        throw new Error('Launch slot trading is unavailable; wait for the standard-fee slot.');
      const q = this.dbc.pool.swapQuote({
        virtualPool: { poolState: pool },
        config,
        swapBaseForQuote: side === 'sell',
        amountIn: input,
        slippageBps: bps,
        hasReferral: false,
        eligibleForFirstSwapWithMinFee: false,
        currentPoint: point,
      });
      out = q.excludedTransferFeeAmountOut;
      min = q.minimumAmountOut;
      fee = q.tradingFee;
    }
    if (out.lte(new BN(0)) || min.lte(new BN(0))) throw new Error('Trade amount is too small.');
    const result = {
      mint,
      side,
      amountIn: amount,
      amountOut: out.toString(),
      minimumAmountOut: min.toString(),
      fee: fee.toString(),
      slippageBps: bps,
      route,
      pool: executionPool.toBase58(),
      quotedAt: Date.now(),
      expiresAt: Date.now() + 20000,
    };
    const quoteId = randomUUID();
    for (const [id, q] of this.quotes) if (q.expiresAt < Date.now()) this.quotes.delete(id);
    if (this.quotes.size >= 5000) this.quotes.delete(this.quotes.keys().next().value!);
    this.quotes.set(quoteId, result);
    return { ...result, quoteId };
  }
  async prepare(tx: Transaction, wallet: string, intent: Record<string, unknown>) {
    await this.enabled();
    const payer = asKey(wallet);
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed');
    tx.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }),
    );
    tx.feePayer = payer;
    tx.recentBlockhash = blockhash;
    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    if (serialized.length > 1232) throw new Error('Transaction exceeds Solana packet size.');
    const simulation = await this.connection.simulateTransaction(
      new VersionedTransaction(tx.compileMessage()),
      { sigVerify: false, commitment: 'confirmed' },
    );
    if (simulation.value.err) {
      this.store.audit('simulation-failed', wallet, { error: simulation.value.err });
      throw new Error(
        `Simulation failed: ${JSON.stringify(simulation.value.err)}. Check balance and current pool state.`,
      );
    }
    const networkFee = (await this.connection.getFeeForMessage(tx.compileMessage(), 'confirmed'))
      .value;
    if (networkFee === null) throw new Error('Unable to estimate network fee.');
    const id = randomUUID(),
      expires = Date.now() + 60000;
    const raw = serialized.toString('base64');
    const messageHash = hash(tx.serializeMessage());
    this.store.db
      .prepare(
        'INSERT INTO prepared_tx(id,wallet,message_hash,raw,height,expires,intent) VALUES(?,?,?,?,?,?,?)',
      )
      .run(id, wallet, messageHash, raw, lastValidBlockHeight, expires, JSON.stringify(intent));
    this.store.audit('transaction-prepared', wallet, { id, intent });
    return {
      id,
      transaction: raw,
      messageHash,
      cluster: this.runtime.cluster,
      lastValidBlockHeight,
      expiresAt: expires,
      networkFee: String(networkFee),
      simulation: { ok: true, units: simulation.value.unitsConsumed },
      intent,
    };
  }
  async setup(wallet: string, configPublicKey: string) {
    if (!this.runtime.feeWallet || wallet !== this.runtime.feeWallet)
      throw new Error('Connect the configured platform fee wallet to set up Forge.');
    await this.enabled();
    if (this.configAddress) throw new Error('A partner config is already registered.');
    const tx = await this.dbc.partner.createConfig2({
      ...forgeCurve(),
      payer: asKey(wallet),
      config: asKey(configPublicKey),
      feeClaimer: asKey(wallet),
      leftoverReceiver: asKey(wallet),
      quoteMint: NATIVE_MINT,
    });
    return this.prepare(tx, wallet, { kind: 'setup', config: configPublicKey, feeWallet: wallet });
  }
  async register(wallet: string, address: string) {
    if (wallet !== this.runtime.feeWallet)
      throw new Error('Only the configured fee wallet can register the partner config.');
    await this.cluster();
    this.validateConfig(await this.dbc.state.getPoolConfig(asKey(address)));
    this.store.setSetting(`dbc-config:${this.runtime.cluster}`, address);
    this.displayReads.clear();
    this.marketCache = null;
    return this.status();
  }
  async launch(wallet: string, mint: string, data: { name: string; ticker: string; uri: string }) {
    await this.enabled();
    await this.configured();
    asKey(mint);
    if (
      !data.name ||
      data.name.length > 32 ||
      !/^[A-Z0-9]{2,10}$/.test(data.ticker) ||
      data.uri.length > 200 ||
      !data.uri.startsWith(this.runtime.publicUrl + '/metadata/')
    )
      throw new Error('Invalid immutable coin metadata.');
    const saved = this.store.db
      .prepare('SELECT * FROM live_coins WHERE mint=? AND creator=?')
      .get(mint, wallet) as StoredCoin | undefined;
    if (
      !saved ||
      saved.uri !== data.uri ||
      saved.name !== data.name ||
      saved.ticker !== data.ticker
    )
      throw new Error('Metadata does not match this wallet and mint.');
    const tx = await this.dbc.creator.createPool({
      name: data.name,
      symbol: data.ticker,
      uri: data.uri,
      payer: asKey(wallet),
      poolCreator: asKey(wallet),
      config: asKey(this.configAddress),
      baseMint: asKey(mint),
    });
    return this.prepare(tx, wallet, {
      kind: 'launch',
      mint,
      name: data.name,
      ticker: data.ticker,
      config: this.configAddress,
      metadataUri: data.uri,
    });
  }
  async swap(
    wallet: string,
    request: {
      mint: string;
      side: 'buy' | 'sell';
      amount: string;
      slippageBps: number;
      minimumAmountOut: string;
      quotedAt: number;
      quoteId?: string;
    },
  ) {
    await this.enabled();
    if (
      !Number.isFinite(request.quotedAt) ||
      Date.now() - request.quotedAt > 20000 ||
      request.quotedAt > Date.now() + 1000
    )
      throw new Error('Quote expired. Request a fresh quote.');
    const original = this.quotes.get(request.quoteId || '');
    if (!original || original.expiresAt < Date.now())
      throw new Error('Quote expired. Request a fresh quote.');
    if (
      original.mint !== request.mint ||
      original.side !== request.side ||
      original.amountIn !== request.amount ||
      original.slippageBps !== request.slippageBps ||
      original.minimumAmountOut !== request.minimumAmountOut
    )
      throw new Error('Trade does not match the quoted intent. Request a fresh quote.');
    const q = await this.quote(request.mint, request.side, request.amount, request.slippageBps);
    const minimum = rawAmount(request.minimumAmountOut);
    if (new BN(q.amountOut).lt(minimum))
      throw new Error('Price moved beyond your minimum received. Review a new quote.');
    let tx: Transaction;
    if (q.route === 'dbc') {
      tx = await this.dbc.pool.swap({
        owner: asKey(wallet),
        pool: asKey(q.pool),
        amountIn: rawAmount(q.amountIn),
        minimumAmountOut: minimum,
        swapBaseForQuote: request.side === 'sell',
        referralTokenAccount: null,
      });
    } else {
      const state = await this.cp.fetchPoolState(asKey(q.pool));
      const [a, b] = await Promise.all([
        getMint(this.connection, state.tokenAMint),
        getMint(this.connection, state.tokenBMint),
      ]);
      if (a.decimals !== 6 || b.decimals !== 9) throw new Error('Unsupported pool decimals.');
      tx = await this.cp.swap({
        payer: asKey(wallet),
        pool: asKey(q.pool),
        inputTokenMint: request.side === 'buy' ? NATIVE_MINT : asKey(request.mint),
        outputTokenMint: request.side === 'buy' ? asKey(request.mint) : NATIVE_MINT,
        amountIn: rawAmount(q.amountIn),
        minimumAmountOut: minimum,
        tokenAMint: state.tokenAMint,
        tokenBMint: state.tokenBMint,
        tokenAVault: state.tokenAVault,
        tokenBVault: state.tokenBVault,
        tokenAProgram: TOKEN_PROGRAM_ID,
        tokenBProgram: TOKEN_PROGRAM_ID,
        referralTokenAccount: null,
        poolState: state,
      });
    }
    return this.prepare(tx, wallet, { kind: 'swap', ...q, minimumAmountOut: minimum.toString() });
  }
  async claim(wallet: string, mint: string, role: 'creator' | 'partner') {
    await this.enabled();
    const { address, pool, config } = await this.pool(mint);
    if (role === 'creator' && !pool.creator.equals(asKey(wallet)))
      throw new Error('Connect the creator wallet.');
    if (role === 'partner' && !config.feeClaimer.equals(asKey(wallet)))
      throw new Error('Connect the partner fee wallet.');
    const max = new BN('18446744073709551615');
    const tx =
      role === 'creator'
        ? await this.dbc.creator.claimCreatorTradingFee({
            creator: asKey(wallet),
            payer: asKey(wallet),
            pool: address,
            maxBaseAmount: max,
            maxQuoteAmount: max,
          })
        : await this.dbc.partner.claimPartnerTradingFee({
            feeClaimer: asKey(wallet),
            payer: asKey(wallet),
            pool: address,
            maxBaseAmount: max,
            maxQuoteAmount: max,
          });
    return this.prepare(tx, wallet, { kind: 'claim-dbc-fees', mint, role });
  }
  async positions(wallet: string) {
    await this.cluster();
    const positions = await this.cp.getPositionsByUser(asKey(wallet));
    return positions.slice(0, 100).map((p) => ({
      position: p.position.toBase58(),
      positionNftAccount: p.positionNftAccount.toBase58(),
      pool: p.positionState.pool.toBase58(),
    }));
  }
  async claimPosition(wallet: string, position: string) {
    await this.enabled();
    const positions = await this.cp.getPositionsByUser(asKey(wallet));
    const owned = positions.find((p) => p.position.toBase58() === position);
    if (!owned) throw new Error('This wallet does not own the position NFT.');
    const pool = owned.positionState.pool,
      state = await this.cp.fetchPoolState(pool);
    await Promise.all([
      getMint(this.connection, state.tokenAMint),
      getMint(this.connection, state.tokenBMint),
    ]);
    const tx = await this.cp.claimPositionFee({
      owner: asKey(wallet),
      receiver: asKey(wallet),
      position: owned.position,
      pool,
      positionNftAccount: owned.positionNftAccount,
      tokenAMint: state.tokenAMint,
      tokenBMint: state.tokenBMint,
      tokenAVault: state.tokenAVault,
      tokenBVault: state.tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
    });
    return this.prepare(tx, wallet, {
      kind: 'claim-damm-position-fees',
      position,
      pool: pool.toBase58(),
    });
  }
  async send(wallet: string, id: string, signed: string) {
    await this.enabled();
    if (typeof signed !== 'string' || signed.length > 2000)
      throw new Error('Invalid signed transaction.');
    const row = this.store.db
      .prepare('SELECT * FROM prepared_tx WHERE id=? AND wallet=?')
      .get(id, wallet) as Pending | undefined;
    if (!row) throw new Error('Unknown transaction intent.');
    const tx = Transaction.from(Buffer.from(signed, 'base64'));
    if (
      !tx.feePayer?.equals(asKey(wallet)) ||
      hash(tx.serializeMessage()) !== row.message_hash ||
      !tx.verifySignatures()
    )
      throw new Error(
        'Signed transaction does not match the prepared intent or is missing signatures.',
      );
    if (row.signature) return { signature: row.signature, alreadySubmitted: true };
    if (
      row.expires < Date.now() ||
      (await this.connection.getBlockHeight('confirmed')) > row.height
    )
      throw new Error('Transaction expired. Rebuild and review again.');
    const signature = bs58.encode(tx.signature!);
    // Persist the deterministic signature BEFORE RPC I/O: a timeout does not prove rejection.
    this.store.db.prepare('UPDATE prepared_tx SET signature=? WHERE id=?').run(signature, id);
    this.store.audit('transaction-submission-started', wallet, { id, signature });
    try {
      const acknowledged = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });
      if (acknowledged !== signature) throw new Error('RPC signature mismatch.');
      this.store.audit('transaction-submitted', wallet, { id, signature });
      return { signature, lastValidBlockHeight: row.height };
    } catch {
      this.store.audit('transaction-submission-unknown', wallet, { id, signature });
      return {
        signature,
        lastValidBlockHeight: row.height,
        warning:
          'RPC submission was not acknowledged. Monitor this signature before retrying; acceptance is uncertain.',
      };
    }
  }
  async transaction(wallet: string, id: string) {
    const row = this.store.db
      .prepare('SELECT * FROM prepared_tx WHERE id=? AND wallet=?')
      .get(id, wallet) as Pending | undefined;
    if (!row) throw new Error('Unknown transaction.');
    if (!row.signature) return { status: row.expires < Date.now() ? 'expired' : 'prepared' };
    const status = (
      await this.connection.getSignatureStatuses([row.signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (status?.err) return { status: 'failed', signature: row.signature, error: status.err };
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      this.marketCache = null;
      this.displayReads.clear();
      return { status: status.confirmationStatus, signature: row.signature };
    }
    const height = await this.connection.getBlockHeight('confirmed');
    return { status: height > row.height ? 'expired' : 'submitted', signature: row.signature };
  }
}
