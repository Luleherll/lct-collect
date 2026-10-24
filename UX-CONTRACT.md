# LCT Collect interaction contract

Authoritative business context: README.md (accepted scope/protocol), src/lib/domain.ts (UGX/workday), firestore.rules (permissions and write validation), docs/ACCOUNT_SETUP.md (manual Auth/profile administration), docs/RECOVERY.md and docs/PILOT.md (operations and release gates). User decisions: no Cloud Functions, no offline writes, keep all three account identifiers, manually create Auth users. This contract records UI consequences; it does not change those policies.

| Capability     | Canonical owner                            | Source of truth       | Allowed variants                                                                                 | Verification                        |
| -------------- | ------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Form           | domain amount parser + App collection flow | README.md + DESIGN.md | Parse before state updates; inline errors; preserve invalid text; first invalid field focused    | tests/e2e/app.spec.ts               |
| Select/Listbox | native select                              | README.md + DESIGN.md | OS-owned popup/keyboard behavior accepted for status and agent filters                           | browser keyboard/native select test |
| Date           | native date input + domain date format     | README.md + DESIGN.md | OS calendar accepted; domain workday uses Africa/Kampala; reject blank changes                   | browser viewer test                 |
| Scrollbar      | src/styles/app.css                         | README.md + DESIGN.md | Global visible scrollbar tokens; forced colors use system baseline                               | narrow viewport and computed styles |
| Toast          | App page feedback + receipt                | README.md + DESIGN.md | Server-confirmed only; persistent critical errors; successful entry includes account/amount      | browser save/recovery test          |
| CRUD           | operations.ts + directory.ts               | README.md + DESIGN.md | Review then explicit save; append-only audit; owner imports preview then explicit apply          | rules + browser suite               |
| Search         | SearchField                                | README.md + DESIGN.md | Local immediate filtering; non-empty clear button; focus returned after clear                    | keyboard browser test               |
| Dialog         | Modal                                      | README.md + DESIGN.md | Native dialog, inert background, latest Escape handler, safe initial focus and focus restoration | browser modal test                  |
| Navigation     | App protect guard                          | README.md + DESIGN.md | App-owned discard dialog for dirty navigation; native beforeunload only for actual unload        | browser draft test                  |

Searches and financial filter text stay in memory: account names/identifiers must not leak to browser history, copied URLs or referrers. History uses bounded session batches; entries load only for a selected day. Header navigation performs normal route loads and cannot silently discard a dirty draft.

Auth defaults to browser-session persistence, with in-memory fallback if storage is blocked. Trusted-device consent controls persistent record reads only; the copy distinguishes it from sign-in lifetime. No financial form payload is stored. A save requires durable session storage of its recovery ID before the server request; blocked storage stops with instructions and never leaves a busy state stuck.

Changing selected member with entered amounts requires an explicit discard decision. Successful financial mutation clears draft and shows a receipt. Uncertain mutation retains the same ID, disables further entry and checks the server; it never automatically replays. Viewer checks show an immediate audited Undo action. The field estimate is not a member balance.

Directory transactions reserve account numbers for one ID permanently and compare preview fingerprints. Old data must be backfilled before enabling new writes; the explicit import Apply phase prepares existing reservations before applying changes. No number reassignment across IDs, no deletion of omitted accounts, no activation of inactive accounts. Five-account chunks keep rules document-access limits bounded. Partial failure states the confirmed progress and instructs re-preview; it does not assume a timed-out chunk failed.
