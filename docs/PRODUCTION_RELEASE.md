# Production Firebase setup and release

The release PR is `develop` → `main`. Merge the production setup changes into
`develop` first. A draft release PR is not evidence that production is provisioned.
The existing production Firebase project is `lct-collect-prod`; staging data and
credentials are not copied into it. No service-account private keys are required.

## Owner setup

Use the existing checkout and Firebase CLI owner sign-in. Install dependencies
only when they are missing. Work from the reviewed setup commit, build Functions
with `npm --prefix functions run build`, and inspect the exact setup plan:

```sh
node scripts/setup-reminders.cjs --project lct-collect-prod
```

This dry run does not authenticate or change billing, IAM, secrets, or deployment
state. `--apply` uses the selected Firebase CLI account or injected ADC.
`--firebase-config PATH` selects a Firebase CLI owner account file securely;
never put credentials or private keys in the repository or a PR.

Enable the Firebase Blaze plan if needed. If production already has enabled
billing, omit `--billing-account`; setup will preserve that selection. To link a
particular billing account, review the plan with its explicit
`--billing-account XXXXXX-XXXXXX-XXXXXX` argument before applying it.

Generate a separate **public** Web Push key in Firebase Console → production
project → Project settings → Cloud Messaging → Web Push certificates. The public
key belongs in `.env.production.example`; private key material must stay in
Firebase. The setup command can save the public key after validating it:

```sh
node scripts/setup-reminders.cjs --project lct-collect-prod \
  --public-vapid-key PRODUCTION_PUBLIC_WEB_PUSH_KEY --apply
```

Setup waits for the Firebase backend APIs to become enabled. It creates the
isolated runtime and a signing secret, preserves enabled signing-key versions,
and discovers the actual regional Functions build identities. It grants the
build role rather than adding Editor, and scopes deployment `actAs` permissions
to the runtime/build service accounts. It does not remove existing roles. If a
discovered account already has project Owner/Editor, setup stops before granting
the deploy identity use of it. Review that account's effective privileges before
explicitly adding `--allow-privileged-build-account`; that flag is not the default.

On a fresh project, setup reports missing Functions and exits **2** after
provisioning prerequisites. Initialize the reviewed backend once as the owner:

```sh
npx -y firebase-tools@15.34.1 deploy --only functions:reminders \
  --project lct-collect-prod
```

This publishes the backend and creates its scheduled reminder dispatcher; it
does not publish Hosting. Run owner setup with `--apply` again afterwards. It
binds deployment administration directly to all five existing managed services,
including `syncOperation`. The four HTTP entry points receive public transport
invocation; callable handlers still require Firebase Authentication/roles, and
reminder validation still requires a signed ticket. The scheduled dispatcher is
not made public. This avoids relying on conditional project grants to initialize
new endpoint invocation policies.

If no default build account exists, or its resource belongs to another project,
setup stops rather than guessing an identity. Resolve that Firebase Functions
build configuration as the owner, then rerun setup. A disabled existing signing
key also stops setup; it is never silently rotated.

## Readiness and promotion

After saving the production public key, use the owner account to check:

```sh
cp .env.production.example .env
node scripts/check-env.mjs
node scripts/check-reminder-env.mjs
FIREBASE_PROJECT_ID=lct-collect-prod node scripts/check-functions-runtime.mjs
FIREBASE_PROJECT_ID=lct-collect-prod node scripts/check-firebase-deployment.cjs
```

The final check is read-only. It verifies enabled APIs, five active Functions in
the expected regions, their dedicated runtime and actual build accounts, HTTP
invocation policies, and the caller's service-policy/`actAs` permissions. Owner
success does not establish GitHub identity readiness: the production workflow
repeats these checks with its own keyless identity before deploying any rules.
Permission/API errors fail the release before publication.

The release workflow scopes `FIREBASE_SKIP_INFORMATIONAL_IAM=true` only to the
Functions deploy command after real runtime/readiness checks. This avoids the
Firebase CLI's incorrect default-App-Engine-account preflight; Firebase's
authorization on actual deployment requests remains enforced.

Keep both the Hosting rewrite and `validateReminder` in `europe-west1`. The three
callable APIs and Firestore remain in `africa-south1`; the scheduler also uses
`europe-west1`. Hosting cannot rewrite to `africa-south1`.

Once setup and CI pass, promote `develop` to `main` through the release PR. Confirm
the production workflow passes Firestore, Functions and Hosting. Verify live
login, daily operations, offline/reconnect sync, Notes, and the same-origin
`/api/reminders/validate/` route. A forged ticket must return HTTP 403 JSON. Real
Android notification delivery requires device/browser permission and a physical
device check on the permanent production origin.

## Current rollout evidence

Staging successfully deployed commit `ea693287016426131d5952e1a7066d537e0493a4`
on 5 November 2026 in
[run 42028826667, attempt 2](https://github.com/Luleherll/lct-collect/actions/runs/42028826667/attempts/2).
That verifies staging only. Production setup must be verified independently;
an empty production public Web Push key or missing owner authentication remains
a release blocker.
