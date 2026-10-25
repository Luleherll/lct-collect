# Deployment and automation

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

The identity and provider have been created in Google Cloud. No service-account private key was created. The account has only these staging-project deployment roles:

- `roles/firebasehosting.admin`
- `roles/firebaserules.admin`
- `roles/datastore.indexAdmin`
- `roles/serviceusage.serviceUsageConsumer`

The provider checks `assertion.environment == 'staging'` directly, together with repository ID `1424838142`, owner ID `36928255`, the `staging` GitHub environment, the exact `deploy-staging.yml` workflow, and the trusted `develop`/`main` refs for push/manual/scheduled events. Pull-request and arbitrary feature-branch tokens are rejected. No Functions, database record access or Firebase user-administration role was granted. The service account can administer security rules, so protect trusted workflow branches appropriately.

The workflow requests `id-token: write` only for its deployment job. Google authentication occurs after tests/build, just before deployment. It uses short-lived credentials instead of `FIREBASE_SERVICE_ACCOUNT`. The Hosting command uses `deploy --only hosting` for the staging project, so it updates the permanent staging URL. A live Hosting channel in the staging project does not deploy the separate production project.

## Activate staging auto-deploy

1. Keep the application and reviewed staging workflow in `develop`. PR #1 established the baseline; merge the permanent-channel correction in PR #2 so later pushes publish the permanent URL.
2. Open Actions → Deploy staging and check the first run. It validates the environment, installs dependencies, runs type checks/security tests/Auth smoke tests, builds, then deploys Firestore rules/indexes and the staging project’s permanent live Hosting channel.
3. Every later push/merge to `develop` deploys automatically. GitHub creates the named `staging` environment on the first environment-backed run if it does not exist.
4. To enable the Actions manual-run UI, the workflow definition must also exist in the repository default branch, `main`. Promote the reviewed baseline to `main` when appropriate; production stays disabled by default. Manual staging runs explicitly check out `develop`. No scheduled renewal is needed for the permanent URL.
5. Configure branch protection/review requirements for trusted branches in repository Settings. Monitor Actions failures and verify the deployed source SHA in the job summary.

The first trusted-branch federated staging deployment passed on 25 October 2026: [run 40230310099, attempt 2](https://github.com/Luleherll/lct-collect/actions/runs/40230310099/attempts/2). It authenticated through the staging service account, deployed Firestore rules/indexes and renewed Hosting from develop commit `15857ff2b034e7ee8a4f99244b938b3dcea96040`. The verified merged build was then promoted to the permanent staging site. An unmerged feature-branch run deliberately cannot impersonate the staging service account.

## Production setup and activation

Production is a separate Firebase project, `lct-collect-prod`, with its own Standard Firestore database in Johannesburg (`africa-south1`), email/password Auth directory, Web App and deploy identity. No real members or application accounts have been imported. Provision accounts using [ACCOUNT_SETUP.md](ACCOUNT_SETUP.md) before a pilot.

Its public Web App configuration is checked into `.env.production.example`. **Production also requires no GitHub secrets.** Its dedicated identity is:

```
lct-github-prod@lct-collect-prod.iam.gserviceaccount.com
```

Provider:

```
projects/275805072037/locations/global/workloadIdentityPools/lct-github-prod/providers/github
```

This identity has the same four deployment roles listed above, confined to the production project. Its provider accepts only repository ID `1424838142`, owner ID `36928255`, the `production` environment, `refs/heads/main`, and the exact `deploy-production.yml` workflow for push/manual events. It cannot be used by the staging workflow. No private key was created.

After staging/pilot acceptance:

1. In repository **Settings → Environments**, restrict `production` deployments to `main`, and set required reviewers if appropriate. Protect `main` with reviews and required CI checks.
2. Merge the reviewed application and workflow files into `main`. Every push to `main` deploys Firestore rules/indexes and the permanent production site at https://lct-collect-prod.web.app (also https://lct-collect-prod.firebaseapp.com).
3. Check authentication, rules/indexes and Hosting steps in the first run. An explicit manual run on `main` can redeploy that selected source commit.

No production enabling variable or GitHub deployment secret is required. The previous `PRODUCTION_DEPLOY_ENABLED` switch is no longer read; the reviewed merge to `main` is the release decision. Repository environment protection settings still apply. The connected GitHub credential cannot edit those protection settings, so the owner manages them in Settings. This configuration change does not deploy production or merge application code into `main`.

The first federated production deployment can only be verified after the workflow runs on trusted `main`. Build/static and emulator checks do not establish that the first cloud CI authentication has succeeded.

## PR previews

| Event                                      | Destination                                    | Backend/configuration                          |
| ------------------------------------------ | ---------------------------------------------- | ---------------------------------------------- |
| Push/merge to `develop`                    | https://lct-collect-staging.web.app            | Staging rules, indexes and Hosting             |
| Push/merge to `main`                       | https://lct-collect-prod.web.app               | Production rules, indexes and Hosting          |
| Same-repository PR targeting either branch | One temporary `pr-<number>` channel URL per PR | Staging web configuration, static Hosting only |

CI builds PR code in the normal unprivileged `pull_request` workflow, then uploads its static output. The trusted `pull_request_target` publisher never checks out or executes PR code. It waits for that exact PR/head SHA to pass CI, downloads only that CI run's artifact, uses the trusted base commit's publishing script and Hosting configuration, and updates one bot comment with the preview URL. Stale/closed PRs are skipped; new commits replace the same channel. Preview content expires seven days after its last deployment. Fork PRs receive CI checks but no credentialed preview deployment.

The preview workflow/script must first be merged into the target branch (PR #2) before GitHub can run this trusted publisher on later PR events. The default branch does not need to receive the application just to enable previews targeting `develop`. No preview workflow deploys rules/indexes or changes the permanent sites. Views use staging data, not production data. Keep real accounts and sensitive records out of unreviewed previews.

Preview identity: `lct-github-preview@lct-collect-staging.iam.gserviceaccount.com`, with only `roles/firebasehosting.admin` and `roles/serviceusage.serviceUsageConsumer` in staging. It has a separate identity pool, `lct-github-preview`, so its tokens cannot use the permanent-deployment service accounts' pool bindings. Its provider pins numeric repository/owner IDs, environment `preview`, event `pull_request_target`, the exact `deploy-preview.yml` path, and trusted `develop`/`main` refs. No private key is created. Hosting's admin role does not enforce a `pr-` channel prefix, so the trusted script restricts the destination to a validated `pr-N` channel; the preview workflow cannot run scripts from the PR artifact. The production provider also checks its environment claim directly to support immutable GitHub subjects.

## Manual staging deployment

Use secure Firebase CLI sign-in, build from the staging config, then:

```sh
npx -y firebase-tools@latest deploy --only firestore:rules,firestore:indexes --project lct-collect-staging
npx -y firebase-tools@15.34.1 deploy --only hosting --project lct-collect-staging --non-interactive
```

Direct-load/refresh `/login/`, `/agent/`, `/agent/recent/`, `/agent/history/`, `/viewer/`, `/admin/`. These are emitted Astro routes, not an SPA catch-all. Static HTTP checks do not replace browser interaction or the Android/paper-parallel pilot.

No Analytics, Cloud Functions or Storage service is initialized. Real member exports must not be loaded into staging.

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
