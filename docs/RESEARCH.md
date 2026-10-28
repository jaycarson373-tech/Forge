# Mogz: evidence and reconstruction

Investigated 28 October 2026. Target is the **MOGZ mint**, not a custom token program:
`Pmfm2RprxQRKZH1XWVsBUc2KgCTyzeDTSFbT1vJmogz`.

## Direct on-chain evidence

Full normalized read: [mogz-chain-snapshot.json](mogz-chain-snapshot.json), collected at `2026-10-28T14:53:56.137Z` through public mainnet RPC. Mint read slot is included in the file. Mint, pool and config reads occur sequentially, so this is not a single-slot atomic snapshot. BN values are decimal strings.

| Field                                | Observed value                                        |
| ------------------------------------ | ----------------------------------------------------- |
| Mint owner                           | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`         |
| Decimals                             | 6                                                     |
| Mint authority / freeze authority    | null / null                                           |
| Current supply                       | 981,608,509.587357 tokens                             |
| DBC program                          | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`         |
| DBC pool                             | `5WjHphSGhuicUuXC2Hur2DcYTxvL6fVRaeJr4wsiPej5`        |
| Partner config                       | `BpRX1sLFrgVPcgZAfpQEZjjnnPCX2CANUzrHn3TouqSq`        |
| Quote mint                           | Wrapped SOL                                           |
| isMigrated / migrationProgress       | 1 / 3                                                 |
| Fee schedule mode / activation type  | Linear / slot                                         |
| Initial numerator / denominator      | 990,000,000 / 1,000,000,000 = 99%                     |
| Period count / duration              | 1 / 1 slot                                            |
| Reduction numerator                  | 985,000,000, leaving 5,000,000 = 0.5%                 |
| Dynamic curve fees                   | Disabled                                              |
| Creator fee percentage               | 75% of the distributable fee after the protocol share |
| Migration quote threshold            | 84,945,948,623 lamports = 84.945948623 SOL            |
| Initial / graduated fixed supply     | 1,000,000,000 / 1,000,000,000 tokens                  |
| Creator / partner permanent LP locks | 50% / 50%                                             |
| Creator / partner withdrawable LP    | 0% / 0%                                               |
| Migration / initial graduated fee    | DAMM v2 / 50 bps                                      |
| Graduated base-fee mode              | 3: linear market-cap scheduler                        |
| First-swap minimum-fee flag          | Enabled                                               |
| Token update authority setting       | Immutable                                             |

Current supply below one billion establishes a lower current supply, not the cause of the difference. We did not trace all burns. The config's `protocolLiquidityMigrationFeeBps` is 20 at the pool level; “no platform graduation fee” must not be read as absence of every protocol-level migration charge.

Explorer links: [mint](https://solscan.io/token/Pmfm2RprxQRKZH1XWVsBUc2KgCTyzeDTSFbT1vJmogz), [DBC pool](https://solscan.io/account/5WjHphSGhuicUuXC2Hur2DcYTxvL6fVRaeJr4wsiPej5), [partner config](https://solscan.io/account/BpRX1sLFrgVPcgZAfpQEZjjnnPCX2CANUzrHn3TouqSq).

## What their public app reveals

Read-only inspection of the homepage and the JavaScript chunks it publicly references found:

- **Next.js/Turbopack**: `/_next/static/chunks/` and `globalThis.TURBOPACK` in served assets.
- **Solana wallet support**: wallet-standard signing feature identifiers and wallet-adapter-style discovery code.
- **Privy compatibility handling**: a filter checks for `privy:` wallet features. This is insufficient to conclude that the app uses Privy as its authentication backend.
- **Shared fee display constants**: a public module returns `total: .5`, `creator: .3`, `platform: .4-.3`, `meteora: .1`, `launchBlock: 99`.

These are frontend observations. No conclusion was reached about their database, hosting provider, RPC vendor, custody architecture, private workers or private source repository. No public repository was positively attributed to the project. The downloaded bundles were examined in scratch storage and are not included in Forge.

## Published behavior versus independently verified behavior

[Mogz's flow documentation](https://mogz.fun/docs/how-it-works) describes DBC launches, fixed supply, migration, rewards and a funded 24-hour trading agent. Its holder and split rewards are paid from a platform wallet. The presence, reliability and controls of those backend workers were not independently verified.

[Mogz's fee specification](https://mogz.fun/docs/fees) documents the 0.5% standard split, one-slot elevated fee, approximately 84.95 SOL graduation threshold and a graduated fee schedule down to 0.1%. The decoded config corroborates the main DBC policy. A high opening-slot fee is an economic deterrent; it does not prove that snipers or bundles cannot participate, and the minimum-fee first-swap flag deserves explicit transaction-level testing.

[The public create form](https://mogz.fun/create) exposes quote-pair selection, reward routing, media upload and agent options. Those controls imply supporting application services; they do not establish how those services are implemented.

Third-party descriptions mention recurring buybacks of MOGZ. This investigation did not verify a minute-by-minute claim-and-buy transaction sequence, and Forge does not claim to implement that service.

## Reconstruction result

The protocol is reusable infrastructure: partner configuration → token/pool initialization → DBC trading → migration → DAMM v2. The product differentiation is the UI, launch policy, fee recipients and application services layered over the protocol.

Forge uses the official [Meteora TypeScript SDK](https://github.com/MeteoraAg/dynamic-bonding-curve-sdk), pinned to **2.0.0**, rather than inventing a new swap program. The [program reference](https://github.com/MeteoraAg/dynamic-bonding-curve) supplies the conceptual configuration model. SDK services are `partner`, `creator`, `pool`, `migration` and `state`.

`forgeCurve()` starts with published economics, then uses the observed integer sqrt-price / liquidity segments. This avoids tiny differences from recalculating the original curve with a newer SDK. The resulting migration quote threshold, starting sqrt price, active curve segments, fee schedule and core policy fields are checked against the saved public snapshot by `tests/meteora.test.ts`.

The creator receives 75% **after** the protocol takes 20%, or 60% of the total fee: `0.50% × 0.80 × 0.75 = 0.30%`. The partner receives 0.10%, and Meteora receives 0.10%. Setting the SDK's creator percentage to 60 would be incorrect for that intended split.

Forge's paper engine deliberately uses a simpler virtual constant-product model. It is suitable for exercising the interface, exact fee accounting, slippage and persistence; it must not supply quotes for real transactions. Live builders accept SDK transaction inputs and require a separately obtained live quote.
