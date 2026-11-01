# Local-first operations

Daily operations save in a project/user-isolated IndexedDB repository before the
UI reports **Saved on this device**. This is local acceptance, not proof that the
office has received the money. Only unsynced work shows a sync label. Opening
cash, entries, eligible void requests, office recording checks, and private note
changes use the queue. CSV imports and account administration remain online.

## Offline preparation and recovery

Sign in online once on a personal trusted device. The active directory, private
notes, current session and agent's latest five workdays are downloaded in the
background. An empty authoritative query is different from a workday not yet
downloaded. Lists show 50 lines at a time from the local data. A first download
still needs connectivity; keep the app open to complete it before field work.

The service worker caches the app shell. Sign-in persists across browser restarts.
Offline work can continue over multiple workdays. Clearing browser/site data can
erase unsynced work; persistent-storage requests reduce eviction risk but cannot
prevent deliberate deletion. If IndexedDB is denied or full, do not report a
successful local save. Online viewing remains available with limited storage.

The unsynced-work control supports retry, human-readable conflict review and a
JSON recovery export. Exported data is private and is not a posting receipt.
Sign-out can preserve unsynced work for the same user's next sign-in; it never
silently discards it. Other users cannot access it through the application.

Local drafts are distinct from accepted commands. Legacy recovery IDs have no
payload: check the server before manually reconstructing an old uncertain entry.
Do not invent or automatically resend its missing form contents.

## Sync protocol

`syncOperation` is a version-1 authenticated callable in `africa-south1` using the
existing runtime service account. Client commands contain stable mutation IDs,
immutable data, captured time, device identity, sequence, scope and dependency.
The backend derives actor/role from Auth and the active profile, validates the
operation, and atomically commits financial changes and a durable mutation
receipt. Receipts are backend-only and must not be expired while replay remains
possible. Both successful and terminally rejected IDs are permanent outcomes.

Financial commands are ordered per session. Notes and recording checks use
record-specific revision dependencies. Other scopes continue past conflicts.
Browser Web Locks coordinate tabs where available; server receipts provide the
final duplicate protection in every browser. An interrupted request retains its
original ID. A reviewed replacement has a new ID and points to its predecessor;
the original failed payload is retained in recovery history.

Only a local storage commit clears the submitted form. Server acknowledgement
reconciles confirmed records and removes the corresponding projection together.
Live snapshots for records affected by pending commands are held until that
receipt is reconciled, avoiding double-counted cash and duplicate entries.

Late entries preserve their claimed Uganda workday (02:00 EAT cutoff), device
capture time and server receipt time. The backend derives session bounds; device
time is untrusted and implausible future timestamps are flagged. Office rows
identify late submissions for review. Acceptance does not imply trustworthy
device time. Late voids remain ineligible under existing policy. Conflicting
opening cash requires explicit review of the existing session, never overwrite.

Overdue one-off reminders save without sending stale push. Weekly reminders
resume at the next future occurrence. A scheduler occurrence change can cause a
completion conflict, which requires review instead of overwriting a new reminder.

Sync resumes on startup, reconnect or foregrounding, with retries and backoff.
The browser need not keep running while closed: reopening resumes the queue.
Expired/revoked authentication pauses uploads; reauthentication and authorization
remain mandatory. The local queue retains the payload in either case.

## Rollout and rollback

1. Deploy the compatible Functions and Firestore rules to staging first. Verify
   the configured runtime identity has the existing Firestore access needed for
   transactions; no new client credentials or public data permissions are added.
2. Deploy the client and test with fictional staging records on small Android
   devices, including airplane mode, restart, and reconnect after 02:00 EAT.
3. When older clients have been refreshed and the pilot passes, create the
   backend-controlled document `config/syncProtocol` with numeric
   `minimumVersion: 1`. This disables legacy direct financial/note creates and
   financial updates. Clients cannot modify the switch or forge/read receipts.
4. Keep backend version 1 and existing receipts available during rollback. Do
   not downgrade a device with queued work to an online-only client. Export and
   reconcile outstanding work before any destructive schema change.

No remote deployment or protocol switch is performed by this code change.
The existing develop/main Hosting workflows deploy Hosting; explicitly deploy
Functions/rules before merging a client that depends on them.

## Verification and operating signals

Use `npm run test:ci`, `npm run check`, `npm run build`, and `npm run test:e2e`.
API tests include duplicate and late posting; security tests include forged
receipts, cross-user access, and the legacy cutover. Browser tests exercise
cached startup without transitional access pages, offline accepted work across
reload, and dependent note edits.

Local saves expose `performance` measures named `lct.local-save` without member
or financial contents. Inspect them on a representative Android device: targets
are p95 <=200 ms for local save/cached navigation and <=100 ms for directory
search. Queue count, error messages and server receipt timestamps support
troubleshooting. No analytics service or payload logging is introduced. Emulator
or desktop performance is not a substitute for the field pilot.

## Security review

See [the review report](SECURITY_REVIEW.json). The review corrected first-edit
reconciliation for legacy notes, bound newly captured commands to their actor
across account switches, and aligned future-session/void validation with the
operational window. Existing pending version-1 commands remain compatible.
Authority still comes exclusively from Firebase Auth and server profile reads.

The PR preview publisher deploys static Hosting only. A successful preview
release does not mean `syncOperation` is deployed. Before field sync acceptance,
verify the callable endpoint in staging and deploy the reviewed backend through
an authorized identity. Do not weaken OIDC branch/workflow restrictions to let
feature-branch code impersonate the permanent staging deployment identity.
