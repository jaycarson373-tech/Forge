import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { decimal, units, marketCap, GRADUATION, type Coin, type PaperState } from './domain';
import './style.css';
async function api<T>(path: string, data?: unknown): Promise<T> {
  const res = await fetch(
    '/api/' + path,
    data === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
  );
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed.');
  return body;
}
const compact = (n: number) =>
  Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const fmt = (n: number, d = 3) => n.toLocaleString('en', { maximumFractionDigits: d });
const TARGET = 'Pmfm2RprxQRKZH1XWVsBUc2KgCTyzeDTSFbT1vJmogz';
type Tab = 'discover' | 'portfolio' | 'revenue' | 'research';
function Spark({
  values,
  color = '#b9ff65',
  large = false,
}: {
  values: number[];
  color?: string;
  large?: boolean;
}) {
  const width = large ? 800 : 190,
    height = large ? 240 : 55;
  const lo = Math.min(...values) * 0.95,
    hi = Math.max(...values) * 1.05;
  const points = values
    .map(
      (v, i) =>
        `${(i / Math.max(1, values.length - 1)) * width},${height - ((v - lo) / (hi - lo || 1)) * height}`,
    )
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={large ? 'chart' : 'spark'}
      role="img"
      aria-label="Simulated market cap history"
    >
      <defs>
        <linearGradient id={`fade-${color.slice(1)}-${large}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".2" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill={`url(#fade-${color.slice(1)}-${large})`}
      />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={large ? 2.4 : 1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
function App() {
  const [state, setState] = useState<PaperState | null>(null),
    [tab, setTab] = useState<Tab>('discover'),
    [filter, setFilter] = useState('trending'),
    [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null),
    [launch, setLaunch] = useState(false),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [wallet, setWallet] = useState('');
  const refresh = async () => setState(await api<PaperState>('paper'));
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const connect = async () => {
    try {
      const provider = (
        window as unknown as {
          solana?: { connect: () => Promise<{ publicKey: { toString: () => string } }> };
        }
      ).solana;
      if (!provider)
        throw new Error(
          'Install a Solana browser wallet to connect. Paper trading works without one.',
        );
      setWallet((await provider.connect()).publicKey.toString());
      setToast('Wallet connected. Trades here still use paper funds.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const coin = state?.coins.find((c) => c.id === selected);
  const nav = [
    ['discover', '◈', 'Discover'],
    ['portfolio', '▣', 'Your portfolio'],
    ['revenue', '◷', 'Fee dashboard'],
    ['research', '⌁', 'Under the hood'],
  ] as const;
  const totals = state?.coins.reduce(
    (acc, c) => ({
      volume: acc.volume + decimal(c.volume),
      creator: acc.creator + decimal(c.creatorFees),
      platform: acc.platform + decimal(c.platformFees),
      protocol: acc.protocol + decimal(c.protocolFees),
    }),
    { volume: 0, creator: 0, platform: 0, protocol: 0 },
  );
  const list = state?.coins
    .filter(
      (c) =>
        (c.name + ' ' + c.ticker).toLowerCase().includes(search.toLowerCase()) &&
        (filter !== 'holders' || c.mode === 'holders'),
    )
    .sort((a, b) =>
      filter === 'new'
        ? b.createdAt - a.createdAt
        : filter === 'graduating'
          ? Number(b.reserve) - Number(a.reserve)
          : Number(b.volume) - Number(a.volume),
    );
  return (
    <>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={() => {
            setTab('discover');
            setSelected(null);
          }}
        >
          <img src="/mark.svg" />
          RIFT<span>//</span>FORGE
        </a>
        <div className="workspace">
          <i /> SOLANA LAB <span>v0.1</span>
        </div>
        <nav>
          {nav.map(([id, icon, label]) => (
            <button
              key={id}
              className={tab === id && !selected ? 'nav active' : 'nav'}
              onClick={() => {
                setTab(id);
                setSelected(null);
              }}
            >
              <span>{icon}</span>
              {label}
              {id === 'discover' && <b>06</b>}
            </button>
          ))}
        </nav>
        <button className="launch-side" onClick={() => setLaunch(true)}>
          ＋ Launch a coin <span>↗</span>
        </button>
        <div className="side-bottom">
          <div className="mini-mark">ϟ</div>
          <h4>Built for the next wave.</h4>
          <p>
            Open code. Transparent fees.
            <br />
            Your own corner of Solana.
          </p>
          <a href="https://github.com/jaycarson373-tech/Forge" target="_blank" rel="noreferrer">
            View source <span>↗</span>
          </a>
          <div className="network">
            <i /> Sandbox online <small>Paper execution</small>
          </div>
        </div>
      </aside>
      <div className="shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> {coin ? coin.ticker : nav.find((n) => n[0] === tab)?.[2]}
          </div>
          <div className="header-right">
            <span className="paper-tag">PAPER MODE</span>
            <button className="wallet" onClick={connect}>
              {wallet ? wallet.slice(0, 4) + '…' + wallet.slice(-4) : 'Connect wallet'}{' '}
              <span>↗</span>
            </button>
          </div>
        </header>
        <main>
          {error && (
            <div role="alert" className="error">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                ×
              </button>
            </div>
          )}
          {!state ? (
            <div className="loading">
              {error
                ? 'Start the API server and reload to open your sandbox.'
                : 'Opening the forge…'}
            </div>
          ) : coin ? (
            <TradeView
              coin={coin}
              state={state}
              onBack={() => setSelected(null)}
              refresh={refresh}
              notify={setToast}
            />
          ) : tab === 'discover' ? (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <div className="eyebrow">
                    <i /> THE NEXT THING STARTS HERE
                  </div>
                  <h1>
                    Find your signal.
                    <br />
                    <em>Forge your own.</em>
                  </h1>
                  <p>
                    A launchpad for the internet’s next obsession.
                    <br />
                    Discover, launch and trade. Keep more of the upside.
                  </p>
                  <div className="hero-actions">
                    <button className="primary" onClick={() => setLaunch(true)}>
                      Launch a coin <span>↗</span>
                    </button>
                    <button className="text-button" onClick={() => setTab('research')}>
                      Explore the mechanics <span>→</span>
                    </button>
                  </div>
                </div>
                <div className="orb-art" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="orb">
                    <span>ϟ</span>
                  </div>
                  <span className="coordinate">
                    RF — 001
                    <br />
                    28.00 / 410.00
                  </span>
                  <span className="art-label">IDEAS INTO ORBIT ↗</span>
                </div>
              </section>
              <div className="stats">
                <Stat
                  label="Sandbox volume"
                  value={`${fmt(totals!.volume)} SOL`}
                  sub="Seeded market + your trades"
                />
                <Stat
                  label="Curve trading fee"
                  value="0.50%"
                  sub="0.30 creator / 0.10 platform / 0.10 protocol"
                />
                <Stat
                  label="Coins in the forge"
                  value={String(state.coins.length).padStart(2, '0')}
                  sub="Launch something worth finding"
                />
                <Stat
                  label="Your paper balance"
                  value={`${fmt(decimal(state.balance))} SOL`}
                  sub="Simulated funds · no monetary value"
                />
              </div>
              <section className="market">
                <div className="section-head">
                  <div>
                    <div className="eyebrow">THE DISCOVERY DECK</div>
                    <h2>
                      Fresh signals
                      <span className="live-dot" />
                    </h2>
                  </div>
                  <label className="search">
                    <span>⌕</span>
                    <input
                      aria-label="Search coins"
                      placeholder="Search name or ticker…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <kbd>/</kbd>
                  </label>
                </div>
                <div className="market-bar">
                  <div className="filters">
                    {[
                      ['trending', '↗ Trending'],
                      ['new', '◷ New launches'],
                      ['graduating', '◈ Near graduation'],
                      ['holders', '✦ Holder rewards'],
                    ].map(([id, label]) => (
                      <button
                        className={filter === id ? 'selected' : ''}
                        onClick={() => setFilter(id)}
                        key={id}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="muted">
                    SOL pairs <span className="green">●</span>
                  </span>
                </div>
                <div className="coin-grid">
                  {list?.map((c) => (
                    <button className="coin-card" key={c.id} onClick={() => setSelected(c.id)}>
                      <div className="card-top">
                        <div
                          className="avatar"
                          style={{ '--coin': c.color } as React.CSSProperties}
                        >
                          {c.glyph}
                        </div>
                        <div>
                          <h3>{c.name}</h3>
                          <span className="ticker">
                            ${c.ticker}{' '}
                            <span>
                              · {Math.max(0, Math.floor((Date.now() - c.createdAt) / 3600000))}h
                            </span>
                          </span>
                        </div>
                        <span className="card-arrow">↗</span>
                      </div>
                      <p className="coin-desc">{c.description || 'A new signal from the forge.'}</p>
                      <div className="card-price">
                        <div>
                          <small>Market cap</small>
                          <strong>
                            {fmt(marketCap(c), 1)} <span>SOL</span>
                          </strong>
                        </div>
                        <Spark values={c.history} color={c.color} />
                      </div>
                      <div className="card-metrics">
                        <span>
                          Volume <b>{fmt(decimal(c.volume))} SOL</b>
                        </span>
                        <span className="reward-pill">
                          {c.mode === 'holders' ? '✦ Holder rewards' : '◈ Creator rewards'}
                        </span>
                      </div>
                      <div className="progress-label">
                        <span>Bonding curve</span>
                        <b>{fmt((Number(c.reserve) / Number(GRADUATION)) * 100, 1)}%</b>
                      </div>
                      <div className="progress">
                        <div
                          style={{
                            width: `${(Number(c.reserve) / Number(GRADUATION)) * 100}%`,
                            background: c.color,
                          }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
                {!list?.length && <div className="empty">No signals match that search.</div>}
              </section>
              <div className="bottom-note">
                <span>✳</span>Every coin starts somewhere.{' '}
                <button onClick={() => setLaunch(true)}>Make yours here ↗</button>
                <small>All market data on this screen is simulated.</small>
              </div>
            </>
          ) : tab === 'portfolio' ? (
            <>
              <PageTitle
                eyebrow="YOUR WORKSPACE"
                title="Your portfolio"
                description="A persistent paper account to put the mechanics through their paces."
              />
              <div className="stats">
                <Stat
                  label="Available paper funds"
                  value={`${fmt(decimal(state.balance))} SOL`}
                  sub="Sandbox balance"
                />
                <Stat
                  label="Open positions"
                  value={String(Object.values(state.holdings).filter((h) => BigInt(h) > 0n).length)}
                  sub="Paper tokens only"
                />
                <Stat
                  label="Executed trades"
                  value={String(state.trades.length)}
                  sub="Recent 500 retained"
                />
              </div>
              <h2>Positions</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Coin</th>
                      <th>Tokens</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.coins
                      .filter((c) => BigInt(state.holdings[c.id] || 0) > 0n)
                      .map((c) => (
                        <tr key={c.id}>
                          <td>
                            {c.name} <span className="muted">${c.ticker}</span>
                          </td>
                          <td>{fmt(decimal(state.holdings[c.id], 6))}</td>
                          <td>
                            <button className="text-button" onClick={() => setSelected(c.id)}>
                              Open market ↗
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {!Object.values(state.holdings).some((h) => BigInt(h) > 0n) && (
                <div className="empty">Your first paper position starts on the discovery deck.</div>
              )}
              <h2>Trade history</h2>
              <History state={state} />
              <button
                className="secondary reset"
                onClick={async () => {
                  if (
                    window.confirm(
                      'Reset this local paper account and remove all sandbox launches and trades?',
                    )
                  ) {
                    await api('paper/reset', {});
                    await refresh();
                    setToast('Sandbox reset to 10 paper SOL.');
                  }
                }}
              >
                Reset sandbox
              </button>
            </>
          ) : tab === 'revenue' ? (
            <>
              <PageTitle
                eyebrow="FOLLOW THE FEES"
                title="Nothing behind the curtain."
                description="Paper fee accounting, calculated from seeded liquidity and your executed trades."
              />
              <div className="stats">
                <Stat
                  label="Total volume"
                  value={`${fmt(totals!.volume)} SOL`}
                  sub="Paper trades"
                />
                <Stat
                  label="Creator accrual"
                  value={`${fmt(totals!.creator, 6)} SOL`}
                  sub="60% of trade fees"
                />
                <Stat
                  label="Platform accrual"
                  value={`${fmt(totals!.platform, 6)} SOL`}
                  sub="20% of trade fees"
                />
                <Stat
                  label="Protocol accrual"
                  value={`${fmt(totals!.protocol, 6)} SOL`}
                  sub="20% of trade fees"
                />
              </div>
              <div className="panel">
                <div className="eyebrow">EVERY 1 SOL TRADE AT THE STANDARD FEE</div>
                <h2>0.005 SOL. Three destinations.</h2>
                <div className="fee-bar">
                  <span>Creator · 60%</span>
                  <span>Platform · 20%</span>
                  <span>Meteora · 20%</span>
                </div>
                <p className="muted">
                  Holder mode designates the creator allocation for holders. This sandbox accrues
                  it; it does not distribute or pay rewards.
                </p>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Coin</th>
                      <th>Volume (SOL)</th>
                      <th>Creator fees</th>
                      <th>Platform fees</th>
                      <th>Recipient</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.coins.map((c) => (
                      <tr key={c.id}>
                        <td>${c.ticker}</td>
                        <td>{fmt(decimal(c.volume))}</td>
                        <td>{fmt(decimal(c.creatorFees), 6)}</td>
                        <td>{fmt(decimal(c.platformFees), 6)}</td>
                        <td>{c.mode}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <Research />
          )}
          <footer>
            <span>
              RIFT//FORGE <span className="muted">· An independent open-source rebuild</span>
            </span>
            <span className="muted">
              Solana × Meteora DBC <span className="green">↗</span>
            </span>
          </footer>
        </main>
      </div>
      {launch && (
        <Launch
          close={() => setLaunch(false)}
          onCreated={async (c) => {
            await refresh();
            setLaunch(false);
            setSelected(c.id);
            setToast(`${c.ticker} created in the paper sandbox.`);
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <span>✓</span>
          {toast}
        </div>
      )}
    </>
  );
}
function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="stat">
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{sub}</span>
    </div>
  );
}
function PageTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-title">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
function History({ state, coinId }: { state: PaperState; coinId?: string }) {
  const trades = state.trades.filter((t) => !coinId || t.coinId === coinId);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Coin</th>
            <th>Side</th>
            <th>Amount in</th>
            <th>Amount out</th>
            <th>Fee (SOL)</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id}>
              <td>${state.coins.find((c) => c.id === t.coinId)?.ticker}</td>
              <td className={t.side === 'buy' ? 'green' : 'pink'}>{t.side.toUpperCase()}</td>
              <td>
                {fmt(decimal(t.input, t.side === 'buy' ? 9 : 6), 6)}{' '}
                {t.side === 'buy' ? 'SOL' : 'tokens'}
              </td>
              <td>
                {fmt(decimal(t.output, t.side === 'buy' ? 6 : 9), 6)}{' '}
                {t.side === 'buy' ? 'tokens' : 'SOL'}
              </td>
              <td>{fmt(decimal(t.fee), 9)}</td>
              <td>{new Date(t.time).toLocaleTimeString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!trades.length && <p className="empty">No paper trades yet.</p>}
    </div>
  );
}
function TradeView({
  coin,
  state,
  onBack,
  refresh,
  notify,
}: {
  coin: Coin;
  state: PaperState;
  onBack: () => void;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy'),
    [amount, setAmount] = useState('0.1'),
    [slippage, setSlippage] = useState('1'),
    [q, setQ] = useState<{ output: string; fee: string; bps: string; version: number } | null>(
      null,
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setQ(null);
    setError('');
    let active = true;
    const timer = setTimeout(() => {
      try {
        const raw = units(amount, side === 'buy' ? 9 : 6);
        api<typeof q>('paper/quote', { coinId: coin.id, side, amount: String(raw) })
          .then((data) => {
            if (active) setQ(data);
          })
          .catch((e) => {
            if (active) setError(e.message);
          });
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [amount, side, coin.id, coin.version]);
  const trade = async () => {
    if (!q) return;
    setBusy(true);
    setError('');
    try {
      const bps = Math.round(Number(slippage) * 100);
      if (!Number.isFinite(bps) || bps < 0 || bps > 5000)
        throw new Error('Slippage must be between 0% and 50%.');
      await api('paper/trade', {
        coinId: coin.id,
        side,
        amount: String(units(amount, side === 'buy' ? 9 : 6)),
        minOut: String((BigInt(q.output) * BigInt(10000 - bps)) / 10000n),
        version: q.version,
      });
      await refresh();
      notify('Paper trade executed and recorded.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="text-button back" onClick={onBack}>
        ← Back to discovery
      </button>
      <div className="coin-heading">
        <div className="avatar" style={{ '--coin': coin.color } as React.CSSProperties}>
          {coin.glyph}
        </div>
        <div>
          <h1>{coin.name}</h1>
          <span className="muted">${coin.ticker} · Paper market · SOL pair</span>
        </div>
      </div>
      <div className="trade-layout">
        <section className="panel chart-panel">
          <div className="chart-head">
            <div>
              <small className="muted">SIMULATED MARKET CAP</small>
              <h2>
                {fmt(marketCap(coin), 2)} <span className="muted">SOL</span>
              </h2>
            </div>
            <span className="reward-pill">{coin.mode} rewards</span>
          </div>
          <Spark values={coin.history} color={coin.color} large />
          <div className="axis">
            <span>Launch</span>
            <span>Paper activity →</span>
            <span>Now</span>
          </div>
          <div className="progress-label">
            <span>Bonding curve progress</span>
            <b>{fmt((Number(coin.reserve) / Number(GRADUATION)) * 100, 2)}%</b>
          </div>
          <div className="progress">
            <div style={{ width: `${(Number(coin.reserve) / Number(GRADUATION)) * 100}%` }} />
          </div>
          <p className="muted">
            {fmt(decimal(coin.reserve))} / 84.95 paper SOL · graduation ends this simulation
          </p>
        </section>
        <section className="panel order-panel">
          <div className="trade-tabs">
            {(['buy', 'sell'] as const).map((s) => (
              <button
                className={side === s ? 'selected' : ''}
                key={s}
                onClick={() => {
                  setSide(s);
                  setAmount(s === 'buy' ? '0.1' : '100');
                }}
              >
                {s === 'buy' ? 'Buy' : 'Sell'}
              </button>
            ))}
          </div>
          <div className="balance">
            Available{' '}
            <b>
              {side === 'buy'
                ? fmt(decimal(state.balance)) + ' paper SOL'
                : fmt(decimal(state.holdings[coin.id] || '0', 6)) + ' ' + coin.ticker}
            </b>
          </div>
          <label>
            Amount{' '}
            <div className="amount">
              <input
                aria-label="Trade amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
              />
              <span>{side === 'buy' ? 'SOL' : coin.ticker}</span>
            </div>
          </label>
          <div className="quick">
            {(side === 'buy' ? ['0.1', '0.5', '1'] : ['100', '1000', '10000']).map((a) => (
              <button key={a} onClick={() => setAmount(a)}>
                {a}
              </button>
            ))}
          </div>
          <label className="slippage">
            Slippage limit{' '}
            <span>
              <input
                aria-label="Slippage percent"
                type="number"
                min="0"
                max="50"
                step="0.1"
                value={slippage}
                onChange={(e) => setSlippage(e.target.value)}
              />
              %
            </span>
          </label>
          <div className="quote-lines">
            <div>
              You receive{' '}
              <b>
                {q ? compact(decimal(q.output, side === 'buy' ? 6 : 9)) : '—'}{' '}
                {side === 'buy' ? coin.ticker : 'SOL'}
              </b>
            </div>
            <div>
              Trading fee <b>{q ? fmt(Number(q.bps) / 100, 2) + '%' : '—'}</b>
            </div>
            <div>
              Fee amount <b>{q ? fmt(decimal(q.fee), 9) : '—'} SOL</b>
            </div>
          </div>
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          <button className="primary full" disabled={!q || busy} onClick={trade}>
            {busy
              ? 'Executing…'
              : `${side === 'buy' ? 'Buy' : 'Sell'} ${coin.ticker} with paper funds`}{' '}
            <span>↗</span>
          </button>
          <p className="order-disclaimer">
            Paper execution only. No wallet signature or real funds. Curve prices approximate the
            mechanics; live quotes must come from Meteora.
          </p>
        </section>
      </div>
      <div className="panel about">
        <h3>About {coin.name}</h3>
        <p>{coin.description || 'No description supplied.'}</p>
        <span className="muted">1B fixed paper supply · 6 decimals · Creator allocation 0%</span>
      </div>
      <h2>Recent paper trades</h2>
      <History state={state} coinId={coin.id} />
    </>
  );
}
function Launch({
  close,
  onCreated,
}: {
  close: () => void;
  onCreated: (c: Coin) => Promise<void>;
}) {
  const [name, setName] = useState(''),
    [ticker, setTicker] = useState(''),
    [description, setDescription] = useState(''),
    [mode, setMode] = useState<'creator' | 'holders'>('creator'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [close]);
  return (
    <div
      className="modal-shade"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="launch-title" className="modal">
        <button className="close" aria-label="Close launch dialog" onClick={close}>
          ×
        </button>
        <div className="eyebrow">ZERO TO SOMETHING</div>
        <h2 id="launch-title">Forge a new coin.</h2>
        <p className="muted">Launch into the local paper market. Make it memorable.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await onCreated(await api<Coin>('paper/create', { name, ticker, description, mode }));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-row">
            <label>
              Coin name
              <input
                autoFocus
                required
                maxLength={32}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="A name worth remembering"
              />
            </label>
            <label>
              Ticker
              <input
                required
                pattern="[A-Za-z0-9]{2,10}"
                maxLength={10}
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="RIFT"
              />
            </label>
          </div>
          <label>
            Description
            <textarea
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What’s the story?"
            />
          </label>
          <label>
            Creator fee recipient
            <div className="reward-options">
              <button
                type="button"
                className={mode === 'creator' ? 'selected' : ''}
                onClick={() => setMode('creator')}
              >
                ◈ Creator<span>Accrue 0.30% per standard trade</span>
              </button>
              <button
                type="button"
                className={mode === 'holders' ? 'selected' : ''}
                onClick={() => setMode('holders')}
              >
                ✦ Holders<span>Designate the fee for holders</span>
              </button>
            </div>
          </label>
          <div className="launch-summary">
            <span>
              Pair <b>SOL</b>
            </span>
            <span>
              Supply <b>1,000,000,000</b>
            </span>
            <span>
              Curve fee <b>0.50%</b>
            </span>
          </div>
          <p className="order-disclaimer">
            Creation-slot paper trades pay 99%; the standard fee begins in the next simulated slot.
            No real token is minted. Devnet transaction builders are included in the source.
          </p>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary full" disabled={busy}>
            {busy ? 'Forging…' : 'Launch paper coin'} <span>↗</span>
          </button>
        </form>
      </section>
    </div>
  );
}
function Research() {
  const [address, setAddress] = useState(TARGET),
    [result, setResult] = useState<unknown>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <>
      <PageTitle
        eyebrow="PUBLIC EVIDENCE → ORIGINAL IMPLEMENTATION"
        title="The mechanics behind the signal."
        description="Mogz is a launchpad on Meteora. Forge reconstructs its published mechanics with original code and a distinct identity."
      />
      <div className="research-grid">
        <article className="panel">
          <span className="step">01 / EXECUTION</span>
          <h2>Meteora DBC → DAMM v2</h2>
          <p>
            Mogz documents a one-billion supply and six decimals, a bonding curve and permanently
            locked graduated liquidity.
          </p>
          <a href="https://mogz.fun/docs/how-it-works" target="_blank" rel="noreferrer">
            Read their published flow ↗
          </a>
        </article>
        <article className="panel">
          <span className="step">02 / ECONOMICS</span>
          <h2>50 basis points, split three ways.</h2>
          <p>
            The published standard split is 30 bps creator, 10 bps platform and 10 bps protocol. The
            launch slot carries a 99% fee.
          </p>
          <a href="https://mogz.fun/docs/fees" target="_blank" rel="noreferrer">
            Read their fee specification ↗
          </a>
        </article>
      </div>
      <div className="panel architecture">
        <div className="eyebrow">THE FORGE IMPLEMENTATION</div>
        <h2>A working sandbox. An explicit chain boundary.</h2>
        <div className="flow">
          <span>React interface</span>
          <b>→</b>
          <span>Local API + SQLite</span>
          <b>→</b>
          <span>Paper curve / fee ledger</span>
        </div>
        <p>
          The SDK module builds real, unsigned DBC transactions for devnet. The browser uses the
          paper engine. Rewards accrue in the sandbox; holder payouts, buyback workers and DAMM v2
          execution are documented integration work.
        </p>
      </div>
      <div className="panel">
        <div className="eyebrow">READ-ONLY / LIVE RPC</div>
        <h2>Inspect a Solana mint.</h2>
        <p className="muted">
          Reads the configured RPC cluster. Server default: mainnet; SOLANA_RPC_URL can override it.
          Public endpoints can rate-limit scans.
        </p>
        <form
          className="scan-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            setResult(null);
            setBusy(true);
            try {
              setResult(await api('inspect/' + encodeURIComponent(address)));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            aria-label="Solana mint address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
          />
          <button className="primary" disabled={busy}>
            {busy ? 'Scanning…' : 'Scan mint ↗'}
          </button>
        </form>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        {!!result && <pre>{JSON.stringify(result, null, 2)}</pre>}
      </div>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
