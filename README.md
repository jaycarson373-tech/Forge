# RIFT//FORGE

**A wallet-signed Solana launchpad on Meteora DBC and DAMM v2.** Original code, reconstructed launch economics and a distinct interface.

## Release status

Live transaction paths are implemented. This release is **not yet production-certified or deployed**. Add your wallet, dedicated RPC, permanent HTTPS origin and persistent hosting last, then complete [deployment acceptance](docs/DEPLOYMENT.md). No mainnet transaction was signed or broadcast during development.

Mainnet quoting and an actual SDK-built DAMM v2 swap simulation passed. Local security tests and browser signing fixtures pass. A full devnet launch/buy/sell run was attempted but blocked by the public faucet returning **410 Gone**. Funded devnet/mainnet acceptance, graduation, public metadata reachability and restore testing remain required.

## Run locally

On this Windows workspace, double-click **Open Forge.cmd** after the first build. It checks whether the API is running, starts the built app in the background when needed, and opens the browser. It can be used again after closing this chat. Startup logs are in `data/local-server.out.log` and `data/local-server.err.log`.

Version 0.2.1 fixes development-proxy sign-in, media/metadata routing, expired sessions and trade rejection after favorable price moves. The landing page now loads a real public market preview before a platform config is registered, with refresh/retry controls when RPC data is unavailable. Mainnet transaction activation still requires your deployment settings.

Node **24.2+**, pnpm **11.25.0**.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:5173. Live mode is the default; the API runs at port 8787. Before settings are added the app opens in a setup state with transactions disabled. The paper playground requires `APP_MODE=paper`; its API is absent in live mode.

```sh
pnpm test                 # domain, wallet auth, intent integrity, persistence, SDK policy
pnpm build                # strict TypeScript + production client
pnpm build:server         # deployable Node server bundle
pnpm start                # local API + built client
pnpm preflight            # operator configuration / RPC / config readiness
pnpm verify:chain         # read-only mainnet market + quote verification
pnpm scan <mint>          # decoded mint / DBC pool / config
pnpm test:devnet           # opt-in test using DEVNET funds only
pnpm exec playwright install chromium
pnpm test:browser         # isolated paper UI regression tests
pnpm test:browser:live    # live UI fixture, real signatures, zero broadcasts
```

Set `CHROME_PATH` for an installed Chromium browser. Screenshots go to `test-results/`. Browser fixtures do not substitute for on-chain acceptance.

## Implemented live paths

| Area       | Behavior                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Wallet     | Phantom/Solflare/Backpack connection, signed nonce login, session expiry                        |
| Discovery  | Actual Forge pools and live market import by mint; no seeded live prices                        |
| Launch     | Browser mint signer, fixed supply, immutable content-addressed metadata, wallet review          |
| Quotes     | Official SDK math for classic SPL/SOL DBC and canonical migrated DAMM v2 pools                  |
| Trading    | Exact input, minimum output, simulation, wallet signature, preflight send, expiry, confirmation |
| Fees       | Direct creator/partner DBC claims and owned DAMM position fee claims                            |
| Portfolio  | Actual SOL/token balances, recent signatures, pending-confirmation recovery                     |
| Setup      | Wallet-signed partner config creation and on-chain policy validation/registration               |
| Storage    | SQLite nonces, hashed sessions, immutable metadata/images, intents and audit events             |
| Deployment | Node production bundle, Dockerfile, Render blueprint, health/readiness endpoints                |

The standard curve fee is **0.50%**: 0.30% creator, 0.10% platform, 0.10% protocol. The policy has a **99% launch-slot fee**; Forge refuses launch-slot trades. The SDK creator percentage is **75% of the post-protocol portion**, producing a 0.30% creator share. Graduated liquidity is permanently locked, split 50/50 between creator and partner.

Creator rewards go directly to the creator wallet. Holder distributions, unattended buybacks, trading agents, charity splits, USDC/custom pairs, social feeds and bounties are **not enabled**. Paper controls are not presented as live services.

## Add deployment values last

Use [.env.production.example](.env.production.example) as the field list. Set secrets in your host environment, never Git. Required values: `PUBLIC_URL`, `SOLANA_RPC_URL`, `PLATFORM_FEE_WALLET` and persistent `DATA_PATH`. Choose the correct `SOLANA_CLUSTER`. Explicitly enable mainnet transactions when the operator intends to sign real setup/trading operations.

Deploy using the [Dockerfile](Dockerfile) or review the [Render blueprint](render.yaml). Applying hosting configuration can incur hosting costs; no resources were provisioned. The final metadata domain and database must stay publicly available. Back up and restore-test the persistent database, including its image/JSON blobs.

## Evidence and limits

[Research](docs/RESEARCH.md), [decoded MOGZ snapshot](docs/mogz-chain-snapshot.json), [architecture](docs/ARCHITECTURE.md), [verification](docs/VERIFICATION.md) and [deployment acceptance](docs/DEPLOYMENT.md).

The API never loads a user's spending key. Each wallet signature authorizes an exact prepared transaction; the server rejects changed messages, wrong-wallet signatures, missing signatures and expired intents. These controls and passing tests are not an independent audit or a guarantee under every network condition.

Original source: MIT. Dependencies and on-chain protocols retain their own licenses. No Mogz private source, artwork, credentials or fee recipients are reused.
