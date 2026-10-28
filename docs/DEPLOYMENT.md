# Live deployment

The repository implements a wallet-signed SOL launchpad. It is **not yet certified production-ready**: operator settings, a funded devnet acceptance run, a controlled mainnet acceptance run, metadata reachability and production infrastructure must be verified after deployment.

## Add these settings last

Use the host's environment editor. Never commit an RPC key, seed phrase or private key.

| Variable                      | Required value                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `NODE_ENV`                    | `production`                                                                        |
| `APP_MODE`                    | `live`                                                                              |
| `PUBLIC_URL`                  | Your permanent HTTPS origin, with no path                                           |
| `SOLANA_CLUSTER`              | `mainnet-beta`, or `devnet` during acceptance                                       |
| `SOLANA_RPC_URL`              | Dedicated RPC on that same cluster, supporting account/program scans and simulation |
| `PLATFORM_FEE_WALLET`         | Your public Solana platform fee wallet                                              |
| `DBC_CONFIG_ADDRESS`          | Optional initially; create/register it in Settings                                  |
| `ENABLE_MAINNET_TRANSACTIONS` | `false` until ready for wallet-signed setup, then `true`                            |
| `DATA_PATH`                   | A persistent-volume path, e.g. `/app/data/forge.sqlite`                             |

Wallet connection alone never authorizes spending. The operator signs config creation, creators sign launches, and traders sign their own swaps. The server has no user spending key.

## Deploy the reviewable build

The included `Dockerfile` builds the web client and a production server bundle. `render.yaml` defines a single-instance service with a persistent disk and environment fields for you to fill in. Applying that blueprint provisions paid hosting; no service was provisioned during development.

Alternatively:

```sh
docker build -t rift-forge .
docker run --env-file .env -p 8787:8787 -v forge-data:/app/data rift-forge
```

Terminate HTTPS at your host or reverse proxy. Use the same permanent origin in `PUBLIC_URL`. A domain change after launch would change metadata URLs, so choose the final origin first. Keep a single application instance using the SQLite volume; horizontal replicas require a different database/rate-limit architecture.

`GET /healthz` is process liveness. `GET /readyz` is launch readiness and returns 503 until the RPC, partner config and activation settings pass. `pnpm preflight` reports the same configuration prerequisites without printing the RPC URL or credentials.

## Establish the partner config

1. Check the app opens at the intended HTTPS URL and the live Settings page reports the correct cluster.
2. Connect the public wallet specified by `PLATFORM_FEE_WALLET`.
3. For mainnet setup, set `ENABLE_MAINNET_TRANSACTIONS=true` once the operator intends to spend network fees and account rent. A wallet signature is still required for each operation.
4. In Settings, choose **Review config creation**. Inspect the review, then sign in your wallet. The server simulates the transaction before review and sends only the exact signed message.
5. After confirmation, the app validates and registers the config in the persistent database. The prepared transaction intent also records the config address. If the browser closes before registration, retrieve that address from the confirmed setup transaction and use **Validate and register**. You may set `DBC_CONFIG_ADDRESS` on the host for explicit configuration.

The validator checks the SOL quote mint, recipient addresses, fixed supply, integer curve geometry, fee policy and locked-liquidity allocation. It does not accept Mogz's original fee wallet as your platform wallet.

## Verify before public trading

- Run `pnpm test`, `pnpm build`, `pnpm build:server`, and both browser suites.
- Run `pnpm verify:chain` for live, read-only pool/quote verification. Set a **public** `SIMULATION_WALLET` if you want an unsigned RPC simulation; this option never signs or sends.
- Complete `pnpm test:devnet` using free devnet funds. The test creates a temporary partner config and token, then buys and sells. It does not test public metadata availability, graduation at the full threshold, or position claims. The public RPC faucet currently returns 410; `DEVNET_RPC_URL` must provide an available faucet, or use a separately funded disposable devnet keypair through `DEVNET_KEYPAIR_PATH`.
- From the real deployed browser, launch a clearly labeled acceptance token with a controlled wallet. Fetch its JSON and image through the permanent public URLs, and check name, symbol, mint/freeze authorities and config in an explorer.
- Exercise a small buy, sell and fee claim under operator control; record transaction signatures and inspect the actual wallet balance changes and minimum-output behavior. No mainnet acceptance trade was executed during development.
- Exercise graduation and DAMM v2 routing on devnet. The live reader derives the canonical migrated pool from the original DBC migration config. Meteora migration availability and program behavior remain protocol dependencies; Forge does not run a funded migration keeper.
- Exercise rejection, expiry, an RPC outage, browser reload during confirmation and wallet switching. Check the transaction in an explorer before retrying an uncertain submission.
- Confirm volume persistence across a deployment restart and test a restore of the SQLite database, including immutable metadata and image blobs. Use SQLite's backup API or stop writes for a consistent backup; do not copy a live WAL database alone.

## Scope and operation

Implemented: classic SPL / SOL launches, DBC swaps, migrated DAMM v2 swaps, wallet sign-in, creator/partner DBC claims, owned DAMM position claims, exact unsigned-intent matching, simulation, expiry checks, confirmation status, content-addressed metadata, rate limits and production headers.

Not enabled: holder reward distribution, unattended buybacks, trading agents, charity routing, custom quote tokens, social feeds or bounties. These require separate service design and operational acceptance; their old paper controls are not presented as live features.

Sessions are one-hour bearer tokens held in browser memory and hashed in SQLite. Nonces expire after five minutes and are single-use. Pending transaction IDs/signatures are stored locally for resuming confirmation; closing the browser loses any unsubmitted mint/config signer. Rebuild unsubmitted work. Never regenerate or resubmit a new trade while the previous signature's status is uncertain.

Rate limits use the direct socket peer and in-process state. Behind a proxy that means requests share the proxy's limit. Add host/WAF limits appropriate to actual traffic and tune the service before a public launch. Do not trust an arbitrary forwarded IP header. Metadata uploads are authenticated, limited by size/type and subject to per-wallet/day and total asset caps. On-chain market discovery currently indexes at most 100 Forge pools per refresh.

No external security audit or live production deployment was completed. Do not describe this release as “100% safe” or “audited.”
