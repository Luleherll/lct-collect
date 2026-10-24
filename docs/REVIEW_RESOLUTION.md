# Review resolution

Scope: address the 24 October 2026 PR review while preserving the approved navy/green collection design, no Cloud Functions, no offline financial writes and manual Auth administration.

| Finding | Resolution | Evidence |
| --- | --- | --- |
| Invalid amount blur could crash | Parse synchronously before any state updater; retain invalid text with associated inline error; add app error boundary | Browser validation and full save/void flow |
| Switching members retained amounts | App-owned discard/change dialog; staying preserves the original entry; confirmed change clears all amounts | Browser account-switch flow |
| Navigation lost drafts | Dirty navigation/cancel/sign-out guard and a beforeunload fallback; no financial draft payload is persisted | Browser navigation guard |
| Deploy selected a moving branch | Event SHA for push/production manual; scheduled staging resolves develop once and logs SHA; CLI pinned to 15.34.1 | Workflow structure checks |
| History read all entries | Initial session query limited to 20; older sessions explicit Load more; entries queried only after choosing a workday; no misleading all-history outstanding counts | Source query inventory and History browser check |
| Storage exceptions broke screens | Guarded storage adapter; financial save cannot start without a recovery-ID write; no cleanup exception turns a confirmed save into failure | Browser denied-storage path |
| Shared-device auth persisted | Browser-session persistence by default with memory fallback; offline-read consent is separate and clearly explained | Auth config + browser sign-in |
| Stale/partial imports | Preview fingerprint comparison, permanent number reservations, five-account chunks, progress and re-preview recovery, old/new values, stale file-response protection | Rules reservation tests + real owner import flow |
| Tests missed actual UI operations | Chromium suite uses compiled app and real operation functions against local demo emulators with 820 synthetic accounts; CI retains traces/screenshots | tests/e2e/app.spec.ts, browser CI job |
| Small inputs/focus | Full-width 56px mobile currency fields, 16px search inputs, post-render deposit focus, safe-area padding and responsive dialogs | 320px browser layout test |
| Generic feedback/audit identity | Account-and-amount saved receipt; recovered entry details; viewer Undo banner; full EAT audit timestamps and validated actor name snapshots | Browser save + viewer recording/undo |
| Coupled frontend/bundle | Extracted shared Modal, Account/Status, SearchField, error boundary, storage/errors, record hook and directory service; lazy login and owner UI | Static build chunks and type check |

Account-number reservation migration: Apply updates explicitly prepares missing reservations for the existing directory before changing account fields. Reserved numbers never move to another account ID. Empty projects need no backfill. Legacy duplicate numbers stop for owner review, and privileged Console/Admin SDK maintenance must preserve reservations. No real member export is used by the tests.

Business decisions implemented from the review: changing account discards its draft only after confirmation; sign-in is session-based; blocked storage permits current-page memory sign-in but financial saves require recovery storage; no extra billing, backend, analytics, account creation or production release was introduced.

Browser emulation does not establish physical Android keyboard behavior or field acceptance. Real-phone and paper-parallel pilot checks in PILOT.md still apply. First GitHub federated deployment needs a trusted-branch run after review/merge; local tests do not prove that cloud authentication succeeded.
