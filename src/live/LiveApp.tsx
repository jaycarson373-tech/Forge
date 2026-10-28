import { useEffect, useRef, useState } from 'react';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { units, decimal } from '../domain';
import './style.css';
type Status = {
  cluster: string;
  publicUrl: string;
  feeWallet: string;
  configAddress: string;
  transactionsEnabled: boolean;
  rpcReady: boolean;
  configReady: boolean;
  launchEnabled: boolean;
  error: string;
};
type Market = {
  mint: string;
  pool: string;
  executionPool: string;
  creator: string;
  name: string;
  ticker: string;
  description: string;
  image: string;
  price: number;
  marketCap: number;
  decimals: number;
  progress: number;
  route: string;
  ownConfig: boolean;
  creatorFees: string;
  platformFees: string;
  observedAt: number;
};
type Balance = {
  sol: string;
  tokens: { mint: string; amount: string; decimals: number }[];
  signatures: { signature: string; time: number; error: unknown }[];
};
type Quote = {
  amountIn: string;
  amountOut: string;
  minimumAmountOut: string;
  slippageBps: number;
  route: string;
  quotedAt: number;
  expiresAt: number;
};
type Prepared = {
  id: string;
  transaction: string;
  messageHash: string;
  cluster: string;
  expiresAt: number;
  networkFee: string;
  simulation: { units: number };
  intent: Record<string, unknown>;
};
type Wallet = {
  connect: () => Promise<{ publicKey: PublicKey }>;
  disconnect?: () => Promise<void>;
  signMessage: (b: Uint8Array, e?: string) => Promise<{ signature: Uint8Array } | Uint8Array>;
  signTransaction: (t: Transaction) => Promise<Transaction>;
  on?: (s: string, f: () => void) => void;
  removeListener?: (s: string, f: () => void) => void;
};
const encode = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
const decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const fmt = (n: number, d = 5) => n.toLocaleString('en', { maximumFractionDigits: d });
const short = (s: string) => (s ? s.slice(0, 5) + '…' + s.slice(-5) : 'Not configured');
const link = (kind: string, id: string, cluster: string) =>
  `https://solscan.io/${kind}/${id}${cluster === 'devnet' ? '?cluster=devnet' : ''}`;
async function api<T>(path: string, data?: unknown, token = ''): Promise<T> {
  const r = await fetch('/api/live/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: {
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Request failed.');
  return j;
}
export function LiveApp() {
  const [status, setStatus] = useState<Status | null>(null),
    [markets, setMarkets] = useState<Market[]>([]),
    [market, setMarket] = useState<Market | null>(null),
    [tab, setTab] = useState('discover'),
    [search, setSearch] = useState(''),
    [address, setAddress] = useState('');
  const [wallet, setWallet] = useState(''),
    [balance, setBalance] = useState<Balance | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [prepared, setPrepared] = useState<Prepared | null>(null),
    [pending, setPending] = useState<{ id: string; signature: string; status: string } | null>(
      null,
    ),
    [choices, setChoices] = useState<{ name: string; p: Wallet }[]>([]);
  const provider = useRef<Wallet | null>(null),
    session = useRef(''),
    extraSigner = useRef<Keypair | null>(null),
    onConfirmed = useRef<null | (() => Promise<void>)>(null),
    monitoring = useRef(false);
  const refresh = async () => {
    const s = await api<Status>('status');
    setStatus(s);
    setMarkets(s.configReady ? await api<Market[]>('markets') : []);
  };
  const refreshBalance = async () => {
    if (wallet) setBalance(await api<Balance>('balance?wallet=' + wallet));
  };
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const t = setInterval(() => refresh().catch(() => {}), 20000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!wallet) return;
    refreshBalance().catch((e) => setError(e.message));
    const t = setInterval(() => refreshBalance().catch(() => {}), 15000);
    const p = provider.current;
    const changed = () => {
      session.current = '';
      setWallet('');
      setBalance(null);
      setPrepared(null);
      extraSigner.current = null;
      setNotice('Wallet changed. Connect again.');
    };
    p?.on?.('accountChanged', changed);
    p?.on?.('disconnect', changed);
    return () => {
      clearInterval(t);
      p?.removeListener?.('accountChanged', changed);
      p?.removeListener?.('disconnect', changed);
    };
  }, [wallet]);
  useEffect(() => {
    if (!market) return;
    const t = setInterval(
      () =>
        api<Market>('market?mint=' + market.mint)
          .then(setMarket)
          .catch((e) => setError(e.message)),
      15000,
    );
    return () => clearInterval(t);
  }, [market?.mint]);
  const connect = async (p?: Wallet) => {
    try {
      if (!p) {
        const w = window as unknown as {
          phantom?: { solana?: Wallet };
          solflare?: Wallet;
          backpack?: Wallet;
          solana?: Wallet;
        };
        const list = [
          { name: 'Phantom', p: w.phantom?.solana },
          { name: 'Solflare', p: w.solflare },
          { name: 'Backpack', p: w.backpack },
          { name: 'Solana wallet', p: w.solana },
        ]
          .filter((x) => x.p)
          .filter((x, i, a) => a.findIndex((y) => y.p === x.p) === i) as {
          name: string;
          p: Wallet;
        }[];
        if (!list.length) throw new Error('Install Phantom, Solflare or Backpack, then reload.');
        if (list.length > 1) {
          setChoices(list);
          return;
        }
        p = list[0].p;
      }
      const r = await p.connect();
      provider.current = p;
      session.current = '';
      setWallet(r.publicKey.toBase58());
      setChoices([]);
      setNotice('Connected. Each live transaction requires your wallet signature.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const auth = async () => {
    if (!provider.current || !wallet) throw new Error('Connect your wallet first.');
    if (session.current) return session.current;
    const c = await api<{ id: string; message: string }>('auth/challenge', { wallet });
    const s = await provider.current.signMessage(new TextEncoder().encode(c.message), 'utf8');
    const r = await api<{ token: string; wallet: string }>('auth/verify', {
      id: c.id,
      signature: encode(s instanceof Uint8Array ? s : s.signature),
    });
    if (r.wallet !== wallet) throw new Error('Wallet changed during sign-in.');
    session.current = r.token;
    return r.token;
  };
  const build = async (
    path: string,
    data: unknown,
    key?: Keypair,
    callback?: () => Promise<void>,
  ) => {
    setBusy(true);
    setError('');
    try {
      const token = await auth();
      const p = await api<Prepared>(path, data, token);
      extraSigner.current = key || null;
      onConfirmed.current = callback || null;
      setPrepared(p);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const monitor = async (id: string, signature: string) => {
    if (monitoring.current) return;
    monitoring.current = true;
    try {
      const token = await auth();
      for (let i = 0; i < 60; i++) {
        const r = await api<{ status: string; error?: unknown }>(
          'transaction?id=' + id,
          undefined,
          token,
        );
        setPending({ id, signature, status: r.status });
        if (['confirmed', 'finalized'].includes(r.status)) {
          localStorage.removeItem('forge-pending');
          setNotice('Transaction confirmed.');
          await onConfirmed.current?.();
          onConfirmed.current = null;
          await refresh();
          await refreshBalance();
          if (market) setMarket(await api<Market>('market?mint=' + market.mint));
          return;
        }
        if (['failed', 'expired'].includes(r.status))
          throw new Error(
            `Transaction ${r.status}. Check the explorer before retrying. ${r.error ? JSON.stringify(r.error) : ''}`,
          );
        await new Promise((r) => setTimeout(r, 1500));
      }
      setNotice(
        'Confirmation is still pending. Check again using the signature; do not submit a duplicate.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      monitoring.current = false;
    }
  };
  const send = async () => {
    if (!prepared || !provider.current || !status) return;
    setBusy(true);
    setError('');
    try {
      if (prepared.cluster !== status.cluster || Date.now() > prepared.expiresAt)
        throw new Error('Transaction expired or changed clusters. Rebuild it.');
      const tx = Transaction.from(decode(prepared.transaction));
      if (tx.feePayer?.toBase58() !== wallet) throw new Error('Fee payer mismatch.');
      const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(tx.serializeMessage()));
      if (
        Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('') !==
        prepared.messageHash
      )
        throw new Error('Transaction integrity check failed.');
      const original = encode(tx.serializeMessage());
      if (extraSigner.current) tx.partialSign(extraSigner.current);
      const signed = await provider.current.signTransaction(tx);
      if (encode(signed.serializeMessage()) !== original)
        throw new Error('Wallet changed the transaction. Rebuild it.');
      const knownSignature = bs58.encode(signed.signature!);
      localStorage.setItem(
        'forge-pending',
        JSON.stringify({ id: prepared.id, signature: knownSignature, wallet }),
      );
      setPending({
        id: prepared.id,
        signature: knownSignature,
        status: 'awaiting RPC acknowledgement',
      });
      const r = await api<{ signature: string; warning?: string }>(
        'send',
        { id: prepared.id, transaction: encode(signed.serialize()) },
        session.current,
      );
      if (r.signature !== knownSignature)
        throw new Error(
          'Submission returned a different signature. Monitor the saved signature before retrying.',
        );
      if (r.warning) setNotice(r.warning);
      const id = prepared.id;
      localStorage.setItem('forge-pending', JSON.stringify({ id, signature: r.signature, wallet }));
      setPrepared(null);
      extraSigner.current = null;
      setPending({ id, signature: r.signature, status: 'submitted' });
      await monitor(id, r.signature);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const resume = async () => {
    try {
      const p = JSON.parse(localStorage.getItem('forge-pending') || 'null');
      if (!p || p.wallet !== wallet) throw new Error('No pending transaction for this wallet.');
      await monitor(p.id, p.signature);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const register = async (config: string) => {
    try {
      await api('config/register', { config: new PublicKey(config).toBase58() }, await auth());
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setMarket(null);
            setTab('discover');
          }}
        >
          <img src="/mark.svg" alt="" />
          RIFT<span>//</span>FORGE
        </a>
        <div className="workspace">
          <i />
          {status?.cluster === 'devnet' ? 'DEVNET' : 'SOLANA MAINNET'}
        </div>
        <nav>
          {[
            ['discover', '◈', 'Discover'],
            ['portfolio', '▣', 'Your portfolio'],
            ['fees', '◷', 'Creator fees'],
            ['settings', '⌁', 'Settings'],
          ].map(([id, icon, name]) => (
            <button
              key={id}
              className={tab === id ? 'nav active' : 'nav'}
              onClick={() => {
                setTab(id);
                setMarket(null);
              }}
            >
              <span>{icon}</span>
              {name}
            </button>
          ))}
        </nav>
        <button
          className="launch-side"
          onClick={() => {
            setTab('launch');
            setMarket(null);
          }}
        >
          ＋ Launch a coin ↗
        </button>
        <div className="side-bottom">
          <h4>Your wallet. Your signature.</h4>
          <p>
            Live protocol execution.
            <br />
            Powered by Meteora.
          </p>
          <a href="https://github.com/jaycarson373-tech/Forge">View source ↗</a>
          <div className="network">
            <i />
            {status?.rpcReady ? 'RPC connected' : 'RPC unavailable'}
            <small>{status?.cluster}</small>
          </div>
        </div>
      </aside>
      <div className="shell">
        <header className="topbar">
          <div className="breadcrumb">
            Forge <span>/</span>
            {market?.ticker || tab}
          </div>
          <div className="header-right">
            <span className="paper-tag live-tag">
              {status?.cluster === 'devnet' ? 'DEVNET' : 'MAINNET'}
            </span>
            <button className="wallet" onClick={() => connect()}>
              {wallet ? short(wallet) : 'Connect wallet'} ↗
            </button>
          </div>
        </header>
        <main>
          {error && (
            <div className="error" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="live-notice" role="status">
              {notice}
              <button aria-label="Dismiss notice" onClick={() => setNotice('')}>
                ×
              </button>
            </div>
          )}
          {pending && (
            <div className="live-notice">
              <a
                href={link('tx', pending.signature, status?.cluster || 'mainnet-beta')}
                target="_blank"
                rel="noreferrer"
              >
                {pending.status} · {short(pending.signature)} ↗
              </a>
              <button disabled={busy} onClick={() => monitor(pending.id, pending.signature)}>
                Check confirmation
              </button>
            </div>
          )}
          {!status ? (
            <div className="loading">Connecting to Solana…</div>
          ) : (
            <>
              {!status.launchEnabled && (
                <div className="setup-banner">
                  <div>
                    <strong>Complete platform setup.</strong>
                    <p>
                      {!status.feeWallet
                        ? 'Add your platform wallet, RPC and public URL in the host environment.'
                        : !status.configReady
                          ? 'Create or register the on-chain partner config.'
                          : !status.transactionsEnabled
                            ? 'Mainnet transactions are disabled in the host environment.'
                            : status.error}
                    </p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => {
                      setTab('settings');
                      setMarket(null);
                    }}
                  >
                    Open settings ↗
                  </button>
                </div>
              )}
              {market ? (
                <LiveMarket
                  market={market}
                  wallet={wallet}
                  balance={balance}
                  enabled={status.rpcReady && status.transactionsEnabled}
                  busy={busy}
                  build={build}
                  back={() => setMarket(null)}
                />
              ) : tab === 'discover' ? (
                <>
                  <section className="hero">
                    <div className="hero-copy">
                      <div className="eyebrow">
                        <i /> LIVE ON SOLANA
                      </div>
                      <h1>
                        Find your signal.
                        <br />
                        <em>Forge your own.</em>
                      </h1>
                      <p>
                        Launch a coin. Trade the curve.
                        <br />
                        Live quotes, wallet signatures and on-chain settlement.
                      </p>
                      <div className="hero-actions">
                        <button
                          className="primary"
                          disabled={!status.launchEnabled}
                          onClick={() => setTab('launch')}
                        >
                          Launch a coin ↗
                        </button>
                        <button className="text-button" onClick={() => setTab('settings')}>
                          Platform settings →
                        </button>
                      </div>
                    </div>
                    <div className="orb-art" aria-hidden="true">
                      <div className="orbit orbit-one" />
                      <div className="orbit orbit-two" />
                      <div className="orb">
                        <span>ϟ</span>
                      </div>
                    </div>
                  </section>
                  <div className="stats">
                    <Stat label="Network" value={status.cluster} sub="RPC genesis verified" />
                    <Stat label="Curve fee" value="0.50%" sub="Forge excludes launch-slot trades" />
                    <Stat
                      label="Indexed Forge coins"
                      value={String(markets.length)}
                      sub="Up to 100 pools · refreshes every 20s"
                    />
                    <Stat
                      label="Your balance"
                      value={balance ? fmt(decimal(balance.sol)) + ' SOL' : 'Connect wallet'}
                      sub="Actual on-chain funds"
                    />
                  </div>
                  <div className="section-head">
                    <h2>
                      Fresh signals
                      <span className="live-dot" />
                    </h2>
                    <label className="search">
                      <input
                        aria-label="Search live coins"
                        placeholder="Search name, ticker or mint…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="scan-form">
                    <input
                      aria-label="Import mint address"
                      placeholder="Open a Solana DBC token by mint address"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                    />
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setError('');
                        api<Market>('market?mint=' + address)
                          .then(setMarket)
                          .catch((e) => setError(e.message));
                      }}
                    >
                      Open market ↗
                    </button>
                  </div>
                  <div className="coin-grid live-grid">
                    {markets
                      .filter((m) =>
                        (m.name + m.ticker + m.mint).toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((m) => (
                        <button className="coin-card" key={m.mint} onClick={() => setMarket(m)}>
                          <div className="card-top">
                            {m.image ? (
                              <img className="avatar" src={m.image} alt="" />
                            ) : (
                              <div
                                className="avatar"
                                style={{ '--coin': '#b9ff65' } as React.CSSProperties}
                              >
                                {m.ticker.slice(0, 2)}
                              </div>
                            )}
                            <div>
                              <h3>{m.name}</h3>
                              <span className="ticker">${m.ticker}</span>
                            </div>
                            <span className="card-arrow">↗</span>
                          </div>
                          <p className="coin-desc">{m.description || short(m.mint)}</p>
                          <div className="card-price">
                            <div>
                              <small>Fully diluted value</small>
                              <strong>
                                {fmt(m.marketCap, 2)} <span>SOL</span>
                              </strong>
                            </div>
                            <span className="reward-pill">{m.route}</span>
                          </div>
                          <div className="progress-label">
                            <span>Curve progress</span>
                            <b>{fmt(m.progress * 100, 1)}%</b>
                          </div>
                          <div className="progress">
                            <div style={{ width: m.progress * 100 + '%' }} />
                          </div>
                        </button>
                      ))}
                  </div>
                  {!markets.length && (
                    <div className="empty">
                      {status.configReady
                        ? 'No coins have launched on this Forge config yet.'
                        : 'Register your partner config to populate the live discovery deck.'}
                    </div>
                  )}
                </>
              ) : tab === 'portfolio' ? (
                <>
                  <Title
                    title="Your portfolio"
                    sub="Chain balances and recent transactions for the connected wallet."
                  />
                  <button className="secondary" disabled={!wallet} onClick={resume}>
                    Resume pending confirmation
                  </button>
                  <div className="stats">
                    <Stat
                      label="SOL balance"
                      value={balance ? fmt(decimal(balance.sol)) + ' SOL' : 'Connect wallet'}
                      sub={wallet}
                    />
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Mint</th>
                          <th>Balance</th>
                          <th>Market</th>
                        </tr>
                      </thead>
                      <tbody>
                        {balance?.tokens.map((t) => (
                          <tr key={t.mint}>
                            <td>
                              <a
                                href={link('token', t.mint, status.cluster)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {short(t.mint)} ↗
                              </a>
                            </td>
                            <td>{fmt(decimal(t.amount, t.decimals), 6)}</td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() =>
                                  api<Market>('market?mint=' + t.mint)
                                    .then(setMarket)
                                    .catch((e) => setError(e.message))
                                }
                              >
                                Open ↗
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <h2>Recent wallet transactions</h2>
                  <div className="table-wrap">
                    <table>
                      <tbody>
                        {balance?.signatures.map((s) => (
                          <tr key={s.signature}>
                            <td>
                              <a
                                href={link('tx', s.signature, status.cluster)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {short(s.signature)} ↗
                              </a>
                            </td>
                            <td>{s.time ? new Date(s.time * 1000).toLocaleString() : 'Pending'}</td>
                            <td>{s.error ? 'Failed' : 'Recorded'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : tab === 'fees' ? (
                <>
                  <Title
                    title="Claim creator fees."
                    sub="Claim DBC fees directly to the signing creator or partner wallet."
                  />
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Coin</th>
                          <th>Creator SOL</th>
                          <th>Partner SOL</th>
                          <th>Claim</th>
                        </tr>
                      </thead>
                      <tbody>
                        {markets
                          .filter((m) => m.creator === wallet || wallet === status.feeWallet)
                          .map((m) => (
                            <tr key={m.mint}>
                              <td>{m.name}</td>
                              <td>{fmt(decimal(m.creatorFees), 9)}</td>
                              <td>{fmt(decimal(m.platformFees), 9)}</td>
                              <td>
                                {m.creator === wallet && (
                                  <button
                                    className="secondary"
                                    disabled={busy}
                                    onClick={() =>
                                      build('claim', { mint: m.mint, role: 'creator' })
                                    }
                                  >
                                    Creator ↗
                                  </button>
                                )}
                                {wallet === status.feeWallet && (
                                  <button
                                    className="secondary"
                                    disabled={busy}
                                    onClick={() =>
                                      build('claim', { mint: m.mint, role: 'partner' })
                                    }
                                  >
                                    Partner ↗
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <Positions wallet={wallet} busy={busy} build={build} />
                  <p className="muted">
                    Holder distributions and automated buybacks are not enabled.
                  </p>
                </>
              ) : tab === 'launch' ? (
                <LiveLaunch
                  enabled={status.launchEnabled}
                  busy={busy}
                  submit={async (name, ticker, description, image) => {
                    setBusy(true);
                    setError('');
                    try {
                      const token = await auth(),
                        mint = Keypair.generate();
                      const m = await api<{ uri: string; name: string; ticker: string }>(
                        'metadata',
                        { mint: mint.publicKey.toBase58(), name, ticker, description, image },
                        token,
                      );
                      await build(
                        'launch',
                        { mint: mint.publicKey.toBase58(), ...m },
                        mint,
                        async () => {
                          setMarket(await api<Market>('market?mint=' + mint.publicKey.toBase58()));
                          setTab('discover');
                        },
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              ) : (
                <>
                  <Title
                    title="Platform settings."
                    sub="Add deployment settings, connect the platform fee wallet, and register your on-chain launch config."
                  />
                  <div className="panel">
                    <dl className="intent">
                      {[
                        ['Network', status.cluster],
                        ['RPC', status.rpcReady ? 'Connected and verified' : 'Unavailable'],
                        ['Fee wallet', status.feeWallet || 'Set PLATFORM_FEE_WALLET'],
                        ['Partner config', status.configAddress || 'Not registered'],
                        ['Public URL', status.publicUrl],
                        [
                          'Transactions',
                          status.transactionsEnabled
                            ? 'Enabled'
                            : 'Set ENABLE_MAINNET_TRANSACTIONS=true',
                        ],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                    {status.error && <p className="inline-error">{status.error}</p>}
                  </div>
                  <div className="panel">
                    <h2>Create partner config.</h2>
                    <p>
                      The platform fee wallet pays network fees and account rent. This creates a
                      reusable SOL launch policy with a 0.5% standard curve fee and permanently
                      locked graduated liquidity.
                    </p>
                    <button
                      className="primary"
                      disabled={
                        busy || !wallet || wallet !== status.feeWallet || !!status.configAddress
                      }
                      onClick={() => {
                        const key = Keypair.generate();
                        build('setup', { config: key.publicKey.toBase58() }, key, () =>
                          register(key.publicKey.toBase58()),
                        );
                      }}
                    >
                      Review config creation ↗
                    </button>
                    <h3>Register an existing Forge config</h3>
                    <div className="scan-form">
                      <input
                        aria-label="Existing partner config"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="Partner config public address"
                      />
                      <button
                        className="secondary"
                        disabled={busy || !wallet || wallet !== status.feeWallet}
                        onClick={() => register(address)}
                      >
                        Validate and register
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
          <footer>
            <span>RIFT//FORGE · Wallet-signed settlement</span>
            <span className="muted">Solana × Meteora · Quotes change before confirmation</span>
          </footer>
        </main>
      </div>
      {!!choices.length && (
        <div className="modal-shade">
          <section className="modal" role="dialog" aria-label="Choose wallet">
            <button
              className="close"
              aria-label="Close wallet selection"
              onClick={() => setChoices([])}
            >
              ×
            </button>
            <h2>Connect a wallet.</h2>
            {choices.map((c) => (
              <button
                className="primary full wallet-option"
                key={c.name}
                onClick={() => connect(c.p)}
              >
                {c.name} ↗
              </button>
            ))}
          </section>
        </div>
      )}
      {prepared && (
        <div className="modal-shade">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
            <button
              className="close"
              disabled={busy}
              aria-label="Close transaction review"
              onClick={() => {
                setPrepared(null);
                extraSigner.current = null;
              }}
            >
              ×
            </button>
            <div className="eyebrow">REVIEW BEFORE SIGNING</div>
            <h2 id="review-title">
              {prepared.cluster === 'devnet' ? 'Devnet' : 'Mainnet'} transaction.
            </h2>
            <p className="muted">
              Mainnet transactions use real funds. The wallet shows the final approval.
            </p>
            <dl className="intent">
              <dt>Action</dt>
              <dd>{String(prepared.intent.kind)}</dd>
              <dt>Wallet</dt>
              <dd>{wallet}</dd>
              {prepared.intent.kind === 'swap' && (
                <>
                  <dt>Input base units</dt>
                  <dd>{String(prepared.intent.amountIn)}</dd>
                  <dt>Minimum received base units</dt>
                  <dd>{String(prepared.intent.minimumAmountOut)}</dd>
                  <dt>Route</dt>
                  <dd>{String(prepared.intent.route)}</dd>
                </>
              )}
              <dt>Network fee estimate</dt>
              <dd>{fmt(decimal(prepared.networkFee), 9)} SOL, plus required account rent</dd>
              <dt>Simulation</dt>
              <dd>Passed · {prepared.simulation.units} compute units</dd>
              <dt>Expires</dt>
              <dd>{new Date(prepared.expiresAt).toLocaleTimeString()}</dd>
            </dl>
            <button
              className="primary full"
              disabled={busy || Date.now() > prepared.expiresAt}
              onClick={send}
            >
              {busy ? 'Waiting for wallet / chain…' : 'Sign and send with wallet ↗'}
            </button>
          </section>
        </div>
      )}
    </>
  );
}
function Positions({
  wallet,
  busy,
  build,
}: {
  wallet: string;
  busy: boolean;
  build: (p: string, d: unknown) => Promise<boolean>;
}) {
  const [positions, setPositions] = useState<{ position: string; pool: string }[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    setPositions([]);
    setError('');
    if (wallet)
      api<{ position: string; pool: string }[]>('positions?wallet=' + wallet)
        .then(setPositions)
        .catch((e) => setError(e.message));
  }, [wallet]);
  return (
    <section className="panel">
      <h2>Graduated liquidity positions</h2>
      <p className="muted">
        Claim trading fees from positions whose NFT is held by your connected wallet. Locked
        liquidity remains locked.
      </p>
      {error && <p className="inline-error">{error}</p>}
      {positions.map((p) => (
        <div className="position-row" key={p.position}>
          <span>
            {short(p.position)} · pool {short(p.pool)}
          </span>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => build('claim-position', { position: p.position })}
          >
            Review position claim ↗
          </button>
        </div>
      ))}
      {!positions.length && !error && <p className="muted">No owned DAMM positions found.</p>}
    </section>
  );
}
function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="stat">
      <small>{label}</small>
      <strong>{value}</strong>
      <span className="break-word">{sub}</span>
    </div>
  );
}
function Title({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="page-title">
      <div className="eyebrow">LIVE WORKSPACE</div>
      <h1>{title}</h1>
      <p>{sub}</p>
    </div>
  );
}
function LiveMarket({
  market: m,
  wallet,
  balance,
  busy,
  enabled,
  build,
  back,
}: {
  market: Market;
  wallet: string;
  balance: Balance | null;
  busy: boolean;
  enabled: boolean;
  build: (p: string, d: unknown) => Promise<boolean>;
  back: () => void;
}) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy'),
    [amount, setAmount] = useState('0.01'),
    [bps, setBps] = useState('100'),
    [q, setQ] = useState<Quote | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setQ(null);
    setError('');
    const update = async () => {
      try {
        const value = await api<Quote>('quote', {
          mint: m.mint,
          side,
          amount: String(units(amount, side === 'buy' ? 9 : m.decimals)),
          slippageBps: Number(bps),
        });
        if (active) {
          setQ(value);
          setError('');
        }
      } catch (e) {
        if (active) {
          setQ(null);
          setError((e as Error).message);
        }
      }
    };
    const t = setTimeout(update, 400),
      i = setInterval(update, 10000);
    return () => {
      active = false;
      clearTimeout(t);
      clearInterval(i);
    };
  }, [m.mint, side, amount, bps]);
  const held = balance?.tokens.find((t) => t.mint === m.mint)?.amount || '0';
  return (
    <>
      <button className="text-button back" onClick={back}>
        ← Back to discovery
      </button>
      <div className="coin-heading">
        <div>
          <h1>{m.name}</h1>
          <span className="muted">
            ${m.ticker} · {m.route} · {m.ownConfig ? 'Forge launch' : 'External partner'}
          </span>
        </div>
      </div>
      <div className="trade-layout">
        <section className="panel">
          <div className="eyebrow">LIVE CHAIN STATE</div>
          <h2>{fmt(m.price, 12)} SOL / token</h2>
          <p>Fully diluted value: {fmt(m.marketCap, 2)} SOL</p>
          <div className="progress-label">
            <span>Curve progress</span>
            <b>{fmt(m.progress * 100, 2)}%</b>
          </div>
          <div className="progress">
            <div style={{ width: m.progress * 100 + '%' }} />
          </div>
          <dl className="intent">
            <dt>Mint</dt>
            <dd>{m.mint}</dd>
            <dt>Execution pool</dt>
            <dd>{m.executionPool}</dd>
            <dt>Creator</dt>
            <dd>{m.creator}</dd>
            <dt>Observed</dt>
            <dd>{new Date(m.observedAt).toLocaleTimeString()}</dd>
          </dl>
          <p>{m.description}</p>
          {!m.ownConfig && (
            <p className="inline-error">
              This token uses another partner’s fees. Review the live quote and wallet transaction.
            </p>
          )}
        </section>
        <section className="panel order-panel">
          <div className="trade-tabs">
            {(['buy', 'sell'] as const).map((s) => (
              <button
                key={s}
                className={s === side ? 'selected' : ''}
                onClick={() => {
                  setSide(s);
                  setAmount(s === 'buy' ? '0.01' : '100');
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
                ? fmt(decimal(balance?.sol || '0')) + ' SOL'
                : fmt(decimal(held, m.decimals)) + ' ' + m.ticker}
            </b>
          </div>
          <label>
            Amount
            <div className="amount">
              <input
                aria-label="Live trade amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <span>{side === 'buy' ? 'SOL' : m.ticker}</span>
            </div>
          </label>
          <label className="slippage">
            Slippage (basis points)
            <input
              aria-label="Live slippage basis points"
              type="number"
              min="0"
              max="1000"
              value={bps}
              onChange={(e) => setBps(e.target.value)}
            />
          </label>
          <div className="quote-lines">
            <div>
              Expected received
              <b>{q ? fmt(decimal(q.amountOut, side === 'buy' ? m.decimals : 9), 8) : '—'}</b>
            </div>
            <div>
              Minimum received
              <b>
                {q ? fmt(decimal(q.minimumAmountOut, side === 'buy' ? m.decimals : 9), 8) : '—'}
              </b>
            </div>
            <div>
              Execution route<b>{q?.route || '—'}</b>
            </div>
          </div>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          <button
            className="primary full"
            disabled={!wallet || !enabled || !q || busy}
            onClick={() =>
              q &&
              build('swap', {
                mint: m.mint,
                side,
                amount: q.amountIn,
                minimumAmountOut: q.minimumAmountOut,
                slippageBps: q.slippageBps,
                quotedAt: q.quotedAt,
              })
            }
          >
            Review {side} ↗
          </button>
          <p className="order-disclaimer">
            Exact-input swap. Quotes refresh every 10s and expire after 20s. Network fees and
            account rent are additional.
          </p>
        </section>
      </div>
    </>
  );
}
function LiveLaunch({
  enabled,
  busy,
  submit,
}: {
  enabled: boolean;
  busy: boolean;
  submit: (n: string, t: string, d: string, i: string) => Promise<void>;
}) {
  const [name, setName] = useState(''),
    [ticker, setTicker] = useState(''),
    [description, setDescription] = useState(''),
    [image, setImage] = useState(''),
    [error, setError] = useState('');
  return (
    <>
      <Title
        title="Forge a live coin."
        sub="One billion tokens. Six decimals. SOL pair. Immutable metadata. Creator fees go directly to your wallet."
      />
      <section className="panel launch-form">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(name, ticker, description, image);
          }}
        >
          <label>
            Coin name
            <input required maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Ticker
            <input
              required
              pattern="[A-Z0-9]{2,10}"
              maxLength={10}
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
            />
          </label>
          <label>
            Description
            <textarea
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label>
            Image (PNG/JPEG, max 1 MB)
            <input
              required
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => {
                setImage('');
                setError('');
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 1000000) {
                  setError('Choose an image under 1 MB.');
                  return;
                }
                const r = new FileReader();
                r.onload = () => setImage(String(r.result));
                r.readAsDataURL(f);
              }}
            />
          </label>
          {error && <p className="inline-error">{error}</p>}
          {!enabled && <p className="inline-error">Complete platform setup before launching.</p>}
          <p className="order-disclaimer">
            Creation costs network fees and account rent. The launch slot carries a 99% fee; Forge
            waits for the next slot before offering trades. No first buy, holder payout or agent is
            enabled.
          </p>
          <button className="primary full" disabled={!enabled || busy || !image}>
            {busy ? 'Preparing…' : 'Review live launch ↗'}
          </button>
        </form>
      </section>
    </>
  );
}
