# Live release verification (v0.2.1)

29 October update: **25 tests passed**, including an actual API/Vite integration test for sign-in, immutable JSON and image routes; favorable/adverse price movement and tampered quote cases; read coalescing; session renewal and strict production origin checks. Both browser suites passed. The live browser fixture explicitly rejects the first preparation with HTTP 401, verifies recovery through a new wallet sign-in, and checks wallet disconnection. Production launch/acceptance limits below remain unchanged.

Verified locally on 28 October 2026 with Node 24.22.1, TypeScript 5.9.3, DBC SDK 2.0.0 and DAMM v2 SDK 1.5.1.

| Check                                                                               | Result                                                            |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Unit/security/persistence/reconstruction tests                                      | 19 passed                                                         |
| Strict TypeScript and production client build                                       | Passed                                                            |
| Production server bundle                                                            | Passed                                                            |
| Original paper UI regression suite                                                  | Passed                                                            |
| Live browser fixture sign-in / buy / sell / creator claim / position claim / launch | Passed with real local Ed25519 signatures; chain responses mocked |
| Live browser fixture broadcasts                                                     | Zero                                                              |
| Desktop / mobile layout                                                             | No page errors or horizontal overflow in tested viewports         |
| Mainnet market read and DAMM v2 quote                                               | Passed; evidence in mainnet-read-verification.json                |
| Actual SDK-built mainnet swap RPC simulation                                        | Passed, 47,411 compute units; unsigned and unbroadcast            |
| RPC interruption recovery                                                           | Tested; deterministic signature saved before submission           |
| Full funded devnet launch/buy/sell                                                  | Blocked: public RPC faucet returned HTTP 410                      |
| Mainnet acceptance trades / graduation / live fee-claim settlement                  | Not performed                                                     |
| Public deployment / metadata reachability / database restore                        | Not performed; operator settings deferred                         |
| Independent security audit                                                          | Not performed                                                     |

Docker build and container smoke checks are included in GitHub CI; the local machine has no Docker executable. Remote CI results must be checked separately. Optional native bigint/WebSocket accelerators remain disabled; tested JavaScript fallbacks are used.

Passing fixture and simulation tests must not be reported as a completed production launch or as a security guarantee. See DEPLOYMENT.md for remaining acceptance.

Additional release validation: repeated full mainnet setup/launch simulation attempts were rate-limited by the public RPC with HTTP 429. These are not recorded as passed. Use a dedicated RPC for the remaining acceptance steps.
