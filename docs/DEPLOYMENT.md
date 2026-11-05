# Deployment and automation

Last updated: 1 November 2026 (Africa/Kampala). Feature details and backend provisioning: [REMINDERS.md](REMINDERS.md).

## Current feature rollout

PR [#5](https://github.com/Luleherll/lct-collect/pull/5), branch `codex/member-types-notes` targeting `develop`, contains account types, compact UI, private reminder notes and soft deletion. Its [preview](https://lct-collect-staging--pr-5-8nk9nf7e.web.app/agent/notes/) is separate from the permanent staging site. Current UI refinements move deletion to list-row trash icons and give the viewer the same connection overlay as agent/admin.

Staging reminder APIs, rules and indexes are deployed, including soft deletion. Feature UI is published to the PR preview; permanent staging receives it through a reviewed merge to `develop`. Production reminder resources/configuration have not been provisioned. After permanent staging is updated, real Android push acceptance is required before production promotion. Preview origins intentionally cannot enrol push devices.

The last complete verified CI before these UI refinements is [run 41302168343](https://github.com/Luleherll/lct-collect/actions/runs/41302168343): 33 browser scenarios, 33 unit tests, 53 rules tests, nine reminder API tests, Auth smoke, formatting, type checks and build. For the current source, use the [PR checks](https://github.com/Luleherll/lct-collect/pull/5/checks); verify its exact head SHA and preview release before merging.

## Current staging deployment

- Firebase project: `lct-collect-staging`.
- Firestore: `(default)`, Standard edition, Johannesburg (`africa-south1`).
- Email/password authentication is enabled. Application users/profiles are still provisioned manually; Google Cloud sign-in does not create an application account.
- Permanent staging: https://lct-collect-staging.web.app (also https://lct-collect-staging.firebaseapp.com).
- Pushes/merges to `develop` publish the staging project’s live Hosting channel. This URL does not expire. Temporary preview channels are separate and are not updated by this workflow.
- Production uses the separate project `lct-collect-prod`; a reviewed merge/push to `main` is its release trigger.

## GitHub credentials

**Staging requires no GitHub secrets and no manually entered GitHub variables.** The workflow loads the public staging Web App selectors from `.env.example`. Those selectors do not grant access to the database.

Deployment uses GitHub OpenID Connect and Google Workload Identity Federation through this dedicated service account:

```
lct-github-staging@lct-collect-staging.iam.gserviceaccount.com
```

Provider:

```
projects/679421917255/locations/global/workloadIdentityPools/lct-github-staging/providers/github
```

The identity and provider have been created in Google Cloud. No service-account private key was created. The staging identity has these project deployment roles:

- `roles/firebasehosting.admin`
- `roles/firebaserules.admin`
- `roles/datastore.indexAdmin`
- `roles/serviceusage.serviceUsageConsumer`
- `roles/cloudfunctions.developer`
- `roles/cloudscheduler.admin`
- `roles/serviceusage.serviceUsageViewer`
- `roles/artifactregistry.reader`

Additional grants are scoped: Cloud Run administration to the four reminder service names; Artifact Registry administration to `gcf-artifacts` repositories; `iam.serviceAccountUser` on the isolated reminder runtime account and the staging Functions build account; and Secret Manager metadata viewing only on the reminder signing secret. The runtime account, rather than the deploy identity, has datastore access, FCM sending and access to the signing secret value. See [REMINDERS.md](REMINDERS.md).

The existing staging build account is
`679421917255-compute@developer.gserviceaccount.com`. After explicit owner
approval, the deploy identity received `roles/iam.serviceAccountUser` on that
account only. It currently has project Editor access, which build execution
inherits. The runtime identity remains the isolated `lct-reminders` account.

Hosting rewrites `/api/reminders/validate/` to the `validateReminder` Firebase
function in `europe-west1`. Hosting rejects a rewrite to `africa-south1`; keep the
rewrite and function region aligned. The reminder worker continues to validate
signed tickets through the same-origin route without enabling cross-origin access.

The provider checks `assertion.environment == 'staging'` directly, together with repository ID `1424838142`, owner ID `36928255`, the `staging` GitHub environment, the exact `deploy-staging.yml` workflow, and the trusted `develop`/`main` refs for push/manual/scheduled events. Pull-request and arbitrary feature-branch tokens are rejected. The Functions permissions support the reminder codebase. The deploy identity has no direct database-record or Firebase user-administration role. The service account can administer security rules, so protect trusted workflow branches appropriately.

The workflow requests `id-token: write` only for its deployment job. Google authentication occurs after tests/build, just before deployment. It uses short-lived credentials instead of `FIREBASE_SERVICE_ACCOUNT`. The Hosting command uses `deploy --only hosting` for the staging project, so it updates the permanent staging URL. A live Hosting channel in the staging project does not deploy the separate production project.

Staging checks every compiled function's explicit dedicated runtime and verifies
`iam.serviceAccounts.actAs` on that account before deploying Functions. Firebase
CLI 15.34.1 incorrectly checks the unused App Engine default account first. Only
the Functions deploy command sets `FIREBASE_SKIP_INFORMATIONAL_IAM=true` to avoid
that informational check; the explicit runtime check fails on missing permission
or an API error, and Firebase still enforces authorization during deployment.
This does not grant access to the default account or change project roles.

## Activate staging auto-deploy

1. Merge the reviewed application/workflow changes into `develop`; staging already uses permanent Hosting deployment.
2. Open Actions → Deploy staging and check the first run. It validates the environment, installs dependencies, runs type checks/security tests/Auth smoke tests, builds, verifies reminder configuration, then deploys Firestore rules/indexes, the `reminders` Functions codebase and the staging project’s permanent live Hosting channel.
3. Every later push/merge to `develop` deploys automatically. GitHub creates the named `staging` environment on the first environment-backed run if it does not exist.
4. To enable the Actions manual-run UI, the workflow definition must also exist in the repository default branch, `main`. Promote the reviewed baseline to `main` when appropriate; production stays disabled by default. Manual staging runs explicitly check out `develop`. No scheduled renewal is needed for the permanent URL.
5. Configure branch protection/review requirements for trusted branches in repository Settings. Monitor Actions failures and verify the deployed source SHA in the job summary.

The first trusted-branch federated staging deployment passed on 25 October 2026: [run 40230310099, attempt 2](https://github.com/Luleherll/lct-collect/actions/runs/40230310099/attempts/2). It authenticated through the staging service account, deployed Firestore rules/indexes and renewed Hosting from develop commit `15857ff2b034e7ee8a4f99244b938b3dcea96040`. The verified merged build was then promoted to the permanent staging site. An unmerged feature-branch run deliberately cannot impersonate the staging service account.

## Production setup and activation

Production is a separate Firebase project, `lct-collect-prod`, with its own Standard Firestore database in Johannesburg (`africa-south1`), email/password Auth directory, Web App and deploy identity. Verify and provision the required pilot accounts using [ACCOUNT_SETUP.md](ACCOUNT_SETUP.md) before a pilot.

Its public Web App configuration is checked into `.env.production.example`. **Production also requires no GitHub secrets.** Its dedicated identity is:

```
lct-github-prod@lct-collect-prod.iam.gserviceaccount.com
```

Provider:

```
projects/275805072037/locations/global/workloadIdentityPools/lct-github-prod/providers/github
```

This identity has the original Hosting/rules/index/service-usage roles confined to the production project. The reminder-specific roles and runtime resources still require production bootstrap; they are not inherited from staging. Its provider accepts only repository ID `1424838142`, owner ID `36928255`, the `production` environment, `refs/heads/main`, and the exact `deploy-production.yml` workflow for push/manual events. It cannot be used by the staging workflow. No private key was created.

After staging/pilot acceptance:

1. In repository **Settings → Environments**, restrict `production` deployments to `main`, and set required reviewers if appropriate. Protect `main` with reviews and required CI checks.
2. Complete production reminder bootstrap, separate public VAPID configuration, signing-secret setup and budget alerts using [REMINDERS.md](REMINDERS.md). The release preflight fails before rules deployment if reminder configuration is incomplete.
3. Merge the reviewed application and workflow files into `main`. Every push to `main` deploys Firestore rules/indexes, the reminder codebase and the permanent production site at https://lct-collect-prod.web.app (also https://lct-collect-prod.firebaseapp.com).
4. Check authentication, rules/indexes, Functions and Hosting steps in the first run. An explicit manual run on `main` can redeploy that selected source commit.

No production enabling variable or GitHub deployment secret is required. The previous `PRODUCTION_DEPLOY_ENABLED` switch is no longer read; the reviewed merge to `main` is the release decision. Repository environment protection settings still apply. The connected GitHub credential cannot edit those protection settings, so the owner manages them in Settings. This configuration change does not deploy production or merge application code into `main`.

Verify production deployment against a successful workflow run on trusted `main`. Local builds and emulator checks do not establish that its cloud authentication or deployment succeeded.

## PR previews

| Event                                      | Destination                                    | Backend/configuration                                     |
| ------------------------------------------ | ---------------------------------------------- | --------------------------------------------------------- |
| Push/merge to `develop`                    | https://lct-collect-staging.web.app            | Staging rules, indexes, reminder Functions and Hosting    |
| Push/merge to `main`                       | https://lct-collect-prod.web.app               | Production rules, indexes, reminder Functions and Hosting |
| Same-repository PR targeting either branch | One temporary `pr-<number>` channel URL per PR | Staging web configuration, static Hosting only            |

CI builds PR code in the normal unprivileged `pull_request` workflow, then uploads its static output. The trusted `pull_request_target` publisher never checks out or executes PR code. It waits for that exact PR/head SHA to pass CI, downloads only that CI run's artifact, uses the trusted base commit's publishing script and Hosting configuration, and updates one bot comment with the preview URL. Stale/closed PRs are skipped; new commits replace the same channel. Preview content expires seven days after its last deployment. Fork PRs receive CI checks but no credentialed preview deployment.

The trusted preview workflow/script is already established in the target branch; changes to that privileged publisher must be reviewed separately. The default branch does not need to receive the application just to enable previews targeting `develop`. No preview workflow deploys rules/indexes or changes the permanent sites. Views use staging data, not production data. Keep real accounts and sensitive records out of unreviewed previews.

Preview identity: `lct-github-preview@lct-collect-staging.iam.gserviceaccount.com`, with only `roles/firebasehosting.admin` and `roles/serviceusage.serviceUsageConsumer` in staging. It has a separate identity pool, `lct-github-preview`, so its tokens cannot use the permanent-deployment service accounts' pool bindings. Its provider pins numeric repository/owner IDs, environment `preview`, event `pull_request_target`, the exact `deploy-preview.yml` path, and trusted `develop`/`main` refs. No private key is created. Hosting's admin role does not enforce a `pr-` channel prefix, so the trusted script restricts the destination to a validated `pr-N` channel; the preview workflow cannot run scripts from the PR artifact. The production provider also checks its environment claim directly to support immutable GitHub subjects.

## Manual staging deployment

For an authorized manual recovery, use a reviewed `develop` commit, secure Firebase CLI sign-in, install both root/functions dependencies and build from `.env.example`. Verify reminder bootstrap first using [REMINDERS.md](REMINDERS.md), then:

```sh
node scripts/check-reminder-env.mjs
npx -y firebase-tools@15.34.1 functions:secrets:get REMINDER_SIGNING_KEY --project lct-collect-staging --non-interactive
npx -y firebase-tools@15.34.1 deploy --only firestore:rules,firestore:indexes --project lct-collect-staging --non-interactive
npx -y firebase-tools@15.34.1 deploy --only functions:reminders --project lct-collect-staging --non-interactive --force
npx -y firebase-tools@15.34.1 deploy --only hosting --project lct-collect-staging --non-interactive
```

Direct-load/refresh `/login/`, `/agent/`, `/agent/recent/`, `/agent/history/`, `/viewer/`, `/admin/`. These are emitted Astro routes, not an SPA catch-all. Static HTTP checks do not replace browser interaction or the Android/paper-parallel pilot.

Analytics and Storage are not initialized. Cloud Functions handle queued daily operations transactionally as well as private notes/reminders. Deploy compatible Functions and rules before the client; see [local-first rollout](LOCAL_FIRST.md). Keep staging and production data separate and apply directory exports only through the owner’s reviewed import flow.

References: [Google GitHub authentication action](https://github.com/google-github-actions/auth), [Firestore locations](https://firebase.google.com/docs/firestore/locations).

## Release integrity and directory reservations

Push deployments check out the triggering commit SHA. Manual staging deployments intentionally check out `develop` once and record the resolved commit in the job summary. Production manual runs use their selected event SHA. Firebase CLI is pinned to 15.34.1 for reproducible deployments. The PR CI browser job exercises real application operations against emulators and retains test traces/screenshots for seven days.

Rules now require a matching immutable `accountNumbers/{number}` reservation for member writes. Before enabling production imports against an older directory, upload its current reviewed CSV and use Apply updates: the app explicitly prepares missing reservations for the current directory before changing any accounts. This one-time phase may take a minute for 820 accounts and displays confirmed progress. Duplicate legacy numbers or conflicts stop the import for owner review; never reassign reservation ownership to bypass an error. Empty projects need no backfill. Privileged console/Admin SDK changes must preserve this mapping too. No real production data was modified as part of the UI refinement.

### Multi-account member directory

Deploy the compatible rules before the UI. Directory records now contain separate `uniqueNumber` (LCT member / ABC group) and numeric `accountNumber` (real Ssentezo account). The original full export supplies both; all accounts remain active as before. Existing numeric document IDs stay stable. New records use `acct_<accountNumber>` IDs. A verified original Account Id bridge restores records affected by the earlier LCT-as-account interpretation, requiring the old LCT/ABC value to match the incoming member number. Old reservations remain immutable, and the real account-number reservation must still match. Once present, member ownership and real account number cannot be reassigned. New entries may carry a validated `uniqueNumberSnapshot`; historical snapshots remain immutable. Staging deployment changes no directory data; the owner reviews and applies the full 820-account export. Superseded 715-row member-only files omit valid accounts and must not be used for the full transition.

## Troubleshooting federated authentication

If `google-github-actions/auth` fails with `unauthorized_client` and “The given credential is rejected by the attribute condition,” inspect the Google Workload Identity provider condition before changing IAM roles or adding secrets. This is a trust-claim mismatch, not a Firebase build failure.

GitHub can issue immutable OIDC subjects. For this repository, `GET /repos/Luleherll/lct-collect/actions/oidc/customization/sub` reports `use_immutable_subject: true` and a prefix containing owner/repository numeric IDs. Consequently, the legacy subject `repo:Luleherll/lct-collect:environment:staging` is not a valid equality check for its current tokens.

The staging provider now checks `assertion.environment == 'staging'` directly. It retains all existing numeric repository/owner checks, exact workflow paths, trusted refs and allowed events. The provider's attribute mapping, service-account binding and deployment roles do not change. This supports both GitHub subject formats without admitting pull requests, other environments or feature branches. Do not remove the repository, workflow or branch restrictions to make authentication pass, and never log the raw OIDC token.

After correcting an external provider condition, rerun the failed job on its original commit. A new application commit is unnecessary. A successful Firebase CLI login on a workstation does not verify the GitHub federated identity: the Actions authentication and deployment steps must pass with that identity.
