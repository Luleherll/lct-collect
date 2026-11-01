# Private reminder notes

General agent notes support plain text (2,000 characters), up to ten member/group tags, one-off or weekly reminders, editing and completion. Financial entry notes remain immutable and retain their original access model. Loan instalments need no Fixed/Saving selection; new loan lines omit that field, while older records/clients remain compatible.

## Runtime and privacy

- `manageNote` (callable, Johannesburg) verifies an active agent, scopes every operation to their UID, validates member tags from the directory and owns schedule/revision metadata. Stable mutation IDs handle uncertain responses; stale edits or occurrence completions fail without overwriting data.
- `registerReminderDevice` (callable, Johannesburg) binds a token/browser installation to the current authenticated agent, replacing older token associations. Runtime device/delivery documents cannot be read or written by clients.
- `dispatchReminders` (scheduled, europe-west1) runs every minute, bounded to 100 due notes and 100 pending delivery records per invocation, with transactional claims, finite retry/backoff and token cleanup. Cloud Scheduler is unavailable in Johannesburg, hence this single cross-region dispatcher. Firestore and the three HTTP APIs remain in Johannesburg.
- `validateReminder` (HTTPS, Johannesburg) validates an expiring HMAC delivery ticket before checking current note, profile and device state. Invalid signatures are rejected before database reads. The endpoint returns validity and an opaque note link, never note text/member names.
- Data-only FCM messages are validated before the existing app worker shows a generic notification. Atomic IndexedDB claims deduplicate foreground/background delivery. The local owner gate suppresses signed-out/wrong-account notifications. Notification clicks restore login destinations and respect dirty-form guards.

Weekly completion crosses off the current occurrence. The next scheduled occurrence reopens the same note. Undo does not replay an already queued/delivered reminder. A reschedule increments schedule identity and invalidates older queued messages. One-off push TTL is four weeks; weekly push TTL ends at the following occurrence. Delivery depends on Android/browser permissions and connectivity. Overdue notes remain in the app even after push expiry. Owners can soft delete a note using its list-row trash icon after confirmation. The viewing popup has no delete action. The backend atomically retains its full contents in `users/{uid}/deletedNotes/{noteId}` with `deletedAt`/`deletedBy`, clears scheduling and removes the active-list document. This keeps legacy notes and cursor pagination compatible without backfilling records. Archived notes are backend-only; stale API edits and legacy client recreates cannot resurrect them. Queued notifications fail validation once the active note is absent. No trash or restore screen is included.

## Staging readiness

Staging has Blaze billing, the isolated `lct-reminders` runtime identity, a signing secret in Secret Manager, the reminder APIs/indexes and a minute scheduler. A $5/month project budget alerts billing administrators at 50%, 90% and 100%; this is **not** a spending cap. Container image cleanup is set to 14 days in Johannesburg and europe-west1. Production billing/resources were not changed during staging implementation.

The committed `PUBLIC_FIREBASE_VAPID_KEY` in `.env.example` is the staging **public** Web Push key, not a private credential. The signing key is never committed, included in the client bundle or printed. Generate a separate production Web Push key before release.

## Owner bootstrap and release

1. Authenticate with Firebase CLI using the project owner. Install root and functions dependencies: `npm ci` and `npm ci --prefix functions`.
2. Review the dry-run of `node scripts/setup-reminders.cjs --project PROJECT_ID --billing-account XXXXXX-XXXXXX-XXXXXX`. Only the known staging/production project IDs are accepted. Add `--apply` to link the chosen billing account and provision APIs, isolated runtime identity, bounded deployment roles and signing secret. Use `--firebase-config PATH` if the Firebase CLI account file is not at the platform default/XDG path. Never supply a service-account private key.
3. Set the environment's public Web Push key. CI verifies it and the secret's existence **before** deploying rules. Production intentionally has no staging-key fallback.
4. Deployment uses existing environment-specific keyless identities. Functions deploy only the `reminders` codebase. `--force` permits reviewed removal of obsolete reminder functions and automatic image-cleanup policy creation; unrelated codebases are excluded. The deploy identity may use only the reminder runtime account; Cloud Run administration is conditioned to the four reminder service names, and Artifact Registry administration to `gcf-artifacts` repositories.
5. Merge the reviewed PR into develop to deploy the permanent staging UI. PR previews can exercise note APIs but do not enrol notification devices on expiring origins. Test Android push on the permanent staging site. Promote develop to main only after acceptance and production bootstrap/key configuration.

## Local verification

`npm run emulators` and `npm run test:e2e` prepare ignored **dummy** `.secret.local`/`.env.local` files and use demo-lct-collect. For remote restricted workspaces, use an empty emulator-only `XDG_CONFIG_HOME` to avoid injecting owner credentials into emulator workers. Do not run production credentials against emulator tests.

- `npm test`: domain, schedule/timezone, worker dedup/privacy and deployment tests.
- `npm run test:rules`: private data access, schema constraints and compatible loan saving/audit.
- `npm run test:reminders`: authenticated API state, ownership, invalid schedules, mutation idempotency, completion/undo, weekly reactivation, device reassignment and signed-ticket validation.
- `npm run test:e2e`: complete collection/viewer/directory flows plus tagged reminder creation, editing, completion, popup/login links, offline viewing and responsive accessibility.

Android acceptance on permanent staging: sign in as agent; explicitly enable reminders; schedule a note a few minutes ahead; close the app and verify one generic notification; tap it and authenticate if required; confirm the correct note. Repeat offline/reconnect, completed/rescheduled stale alerts, and sign-out/account switching. This requires a real device and user-granted browser permission; emulator tests do not certify physical push delivery.
