/** Paper execution model. This virtual constant-product curve is NOT a Meteora quote. */
export const NANO = 1_000_000_000n;
export const MICRO = 1_000_000n;
export const GRADUATION = 84_950_000_000n;
export const SUPPLY = 1_000_000_000n * MICRO;
export type Coin = {
  id: string;
  name: string;
  ticker: string;
  description: string;
  color: string;
  glyph: string;
  createdAt: number;
  launchSlot: number;
  virtualBase: string;
  virtualQuote: string;
  reserve: string;
  volume: string;
  creatorFees: string;
  platformFees: string;
  protocolFees: string;
  mode: 'creator' | 'holders';
  version: number;
  history: number[];
};
export type Trade = {
  id: string;
  coinId: string;
  side: 'buy' | 'sell';
  input: string;
  output: string;
  fee: string;
  time: number;
};
export type PaperState = {
  balance: string;
  holdings: Record<string, string>;
  coins: Coin[];
  trades: Trade[];
};
export function units(value: string, decimals = 9): bigint {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value) || value.length > 40)
    throw new Error('Enter a positive decimal amount.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error(`Use at most ${decimals} decimal places.`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
}
export function decimal(value: string | bigint, decimals = 9): number {
  return Number(value) / 10 ** decimals;
}
export function feeBps(coin: Coin, slot: number): bigint {
  return slot === coin.launchSlot ? 9900n : 50n;
}
export function splitFee(fee: bigint) {
  const creator = (fee * 60n) / 100n;
  const protocol = (fee * 20n) / 100n;
  return { creator, protocol, platform: fee - creator - protocol };
}
export function marketCap(coin: Coin) {
  return (Number(coin.virtualQuote) / Number(coin.virtualBase)) * 1e6;
}
export function quote(coin: Coin, side: 'buy' | 'sell', amount: bigint, slot: number) {
  if (amount <= 0n || amount > 10n ** 30n) throw new Error('Amount is outside the allowed range.');
  if (BigInt(coin.reserve) >= GRADUATION)
    throw new Error('Paper curve complete. DAMM v2 trading requires the live integration.');
  const x = BigInt(coin.virtualBase),
    y = BigInt(coin.virtualQuote),
    bps = feeBps(coin, slot);
  let fee: bigint, output: bigint, nextBase: bigint, nextQuote: bigint, nextReserve: bigint;
  if (side === 'buy') {
    fee = (amount * bps + 9999n) / 10000n;
    const net = amount - fee;
    if (BigInt(coin.reserve) + net > GRADUATION)
      throw new Error('Trade exceeds remaining paper curve capacity.');
    output = (x * net) / (y + net);
    nextBase = x - output;
    nextQuote = y + net;
    nextReserve = BigInt(coin.reserve) + net;
  } else {
    const gross = (y * amount) / (x + amount);
    if (gross > BigInt(coin.reserve)) throw new Error('Insufficient real quote reserves.');
    fee = (gross * bps + 9999n) / 10000n;
    output = gross - fee;
    nextBase = x + amount;
    nextQuote = y - gross;
    nextReserve = BigInt(coin.reserve) - gross;
  }
  if (output <= 0n) throw new Error('Amount is too small after fees.');
  return { output, fee, nextBase, nextQuote, nextReserve, bps };
}
export function makeCoin(
  name: string,
  ticker: string,
  description = '',
  mode: 'creator' | 'holders' = 'creator',
  slot = Math.floor(Date.now() / 400),
): Coin {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 32)
    throw new Error('Name must contain 1–32 characters.');
  if (typeof ticker !== 'string' || !/^[A-Za-z0-9]{2,10}$/.test(ticker))
    throw new Error('Ticker must be 2–10 letters or numbers.');
  if (typeof description !== 'string' || description.length > 500)
    throw new Error('Description must be under 500 characters.');
  if (!['creator', 'holders'].includes(mode)) throw new Error('Choose creator or holder rewards.');
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    ticker: ticker.toUpperCase(),
    description,
    color: '#b9ff65',
    glyph: ticker.slice(0, 2).toUpperCase(),
    createdAt: Date.now(),
    launchSlot: slot,
    virtualBase: '1071428571428571',
    virtualQuote: '30000000000',
    reserve: '0',
    volume: '0',
    creatorFees: '0',
    platformFees: '0',
    protocolFees: '0',
    mode,
    version: 0,
    history: [28],
  };
}
export function seedState(): PaperState {
  const specs = [
    ['Moon Circuit', 'CIRCUIT', 'A signal for the nocturnal builders.', '#b9ff65', '◎', 24],
    ['Void Cat', 'VOID', 'Nine lives. Zero gravity.', '#ba9dff', '✦', 61],
    ['Static Club', 'STATIC', 'For everyone tuned to a different frequency.', '#ffab72', 'ϟ', 12],
    ['Orbit Culture', 'ORBIT', 'A little farther out.', '#83cafa', '◉', 43],
    ['Pixel Cult', 'PIXEL', 'Small pixels, big ideas.', '#ff8aa9', '▦', 6],
    ['Chrome Frog', 'CHROME', 'Cold metal. Warm blood.', '#b1babd', '⌘', 76],
  ] as const;
  const coins = specs.map(([name, ticker, desc, color, glyph, sol], i) => {
    const c = makeCoin(
      name,
      ticker,
      desc,
      i % 2 ? 'holders' : 'creator',
      Math.floor(Date.now() / 400) - 10000,
    );
    c.color = color;
    c.glyph = glyph;
    c.createdAt -= (i + 1) * 3600000;
    const q = quote(c, 'buy', BigInt(sol) * NANO, c.launchSlot + 1);
    c.virtualBase = String(q.nextBase);
    c.virtualQuote = String(q.nextQuote);
    c.reserve = String(q.nextReserve);
    c.volume = String(BigInt(sol) * NANO);
    const f = splitFee(q.fee);
    c.creatorFees = String(f.creator);
    c.platformFees = String(f.platform);
    c.protocolFees = String(f.protocol);
    c.history = Array.from(
      { length: 48 },
      (_, j) => 28 + (marketCap(c) - 28) * (j / 47) ** 1.2 * (1 + Math.sin(j * 1.7 + i) * 0.07),
    );
    return c;
  });
  return { balance: String(10n * NANO), holdings: {}, coins, trades: [] };
}
export function execute(
  state: PaperState,
  request: {
    coinId: string;
    side: 'buy' | 'sell';
    amount: string;
    minOut: string;
    version: number;
  },
  slot = Math.floor(Date.now() / 400),
): Trade {
  if (request.side !== 'buy' && request.side !== 'sell') throw new Error('Invalid trade side.');
  if (!/^\d{1,32}$/.test(request.amount) || !/^\d{1,32}$/.test(request.minOut))
    throw new Error('Trade amounts must be positive integer base units.');
  const c = state.coins.find((c) => c.id === request.coinId);
  if (!c) throw new Error('Coin not found.');
  if (c.version !== request.version) throw new Error('Quote expired. Refresh and try again.');
  const amount = BigInt(request.amount),
    holding = BigInt(state.holdings[c.id] || '0');
  if (request.side === 'buy' && amount > BigInt(state.balance))
    throw new Error('Insufficient paper SOL balance.');
  if (request.side === 'sell' && amount > holding)
    throw new Error('Insufficient paper token balance.');
  const q = quote(c, request.side, amount, slot);
  if (q.output < BigInt(request.minOut))
    throw new Error('Slippage limit exceeded. Refresh your quote.');
  state.balance = String(BigInt(state.balance) + (request.side === 'buy' ? -amount : q.output));
  state.holdings[c.id] = String(holding + (request.side === 'buy' ? q.output : -amount));
  c.virtualBase = String(q.nextBase);
  c.virtualQuote = String(q.nextQuote);
  c.reserve = String(q.nextReserve);
  const fees = splitFee(q.fee);
  c.creatorFees = String(BigInt(c.creatorFees) + fees.creator);
  c.platformFees = String(BigInt(c.platformFees) + fees.platform);
  c.protocolFees = String(BigInt(c.protocolFees) + fees.protocol);
  c.volume = String(BigInt(c.volume) + (request.side === 'buy' ? amount : q.output + q.fee));
  c.version++;
  c.history = [...c.history, marketCap(c)].slice(-120);
  const trade: Trade = {
    id: crypto.randomUUID(),
    coinId: c.id,
    side: request.side,
    input: String(amount),
    output: String(q.output),
    fee: String(q.fee),
    time: Date.now(),
  };
  state.trades.unshift(trade);
  state.trades = state.trades.slice(0, 500);
  return trade;
}
