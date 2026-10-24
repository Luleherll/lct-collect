# Deployment and automation

## Current staging deployment

- Firebase project: `lct-collect-staging`.
- Firestore: `(default)`, Standard edition, Johannesburg (`africa-south1`).
- Email/password authentication is enabled. Application users/profiles are still provisioned manually; Google Cloud sign-in does not create an application account.
- Preview: https://lct-collect-staging--staging-5osd9ys7.web.app
- The preview expires on 23 November 2026 unless renewed. Every staging deployment renews it for 30 days.
- Production uses the separate project `lct-collect-prod`; its Hosting deployment remains disabled until the owner enables it.

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

The provider accepts only repository ID `1424838142`, owner ID `36928255`, the `staging` GitHub environment, the exact `deploy-staging.yml` workflow, and the trusted `develop`/`main` refs for push/manual/scheduled events. Pull-request and arbitrary feature-branch tokens are rejected. No Functions, database record access or Firebase user-administration role was granted. The service account can administer security rules, so protect trusted workflow branches appropriately.

The workflow requests `id-token: write` only for its deployment job. Google authentication occurs after tests/build, just before deployment. It uses short-lived credentials instead of `FIREBASE_SERVICE_ACCOUNT`. The Hosting command skips Auth-domain synchronization; the current preview domain was authorized during the initial owner deployment.

## Activate staging auto-deploy

1. Review and merge PR #1 into `develop`. This first push to `develop` activates the staging workflow. The workflow file and application must both be present in `develop`.
2. Open Actions → Deploy staging and check the first run. It validates the environment, installs dependencies, runs type checks/security tests/Auth smoke tests, builds, then deploys Firestore rules/indexes and the `staging` Hosting channel.
3. Every later push/merge to `develop` deploys automatically. GitHub creates the named `staging` environment on the first environment-backed run if it does not exist.
4. To enable scheduled renewal and the Actions manual-run UI, the workflow definition must also exist in the repository default branch, `main`. Promote the reviewed baseline to `main` when appropriate; production stays disabled by default. The scheduled job runs on the 1st and 15th at 09:00 Uganda time and explicitly checks out `develop`.
5. Configure branch protection/review requirements for trusted branches in repository Settings. Monitor Actions failures and preview expiry: schedules are best-effort.

The first federated deployment cannot be verified until the workflow runs from a trusted ref. An unmerged feature-branch run deliberately cannot impersonate the staging service account.

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

1. In repository **Settings → Environments**, create `production`, restrict deployment branches to `main`, and set required reviewers if available for this repository/account. Protect `main` with reviews and required CI checks.
2. Promote the reviewed application and workflow files from `develop` into `main`. Production remains disabled while the enabling variable is absent.
3. In **Settings → Secrets and variables → Actions → Variables**, create a **repository variable** named `PRODUCTION_DEPLOY_ENABLED` with value `true`. This is a non-secret switch, not an environment-level variable. No other manually entered variables are required.
4. Open **Actions → Deploy production → Run workflow**, select `main`, and start it. Setting the variable alone does not trigger a run. Later reviewed pushes to `main` deploy automatically.
5. Check the authentication, rules/indexes and Hosting steps in that first run. The intended live URL is https://lct-collect-prod.web.app; no production Hosting release has been published during this setup.

The connected GitHub credential cannot write repository variables or environment protection settings (GitHub returns 403). The owner must make the Settings changes above. No JSON secret needs to be uploaded. Remove the enabling variable or set it to `false` to disable subsequent production jobs.

The first federated production deployment can only be verified after the workflow runs on trusted `main`. Build/static and emulator checks do not establish that the first cloud CI authentication has succeeded.

## Manual staging deployment

Use secure Firebase CLI sign-in, build from the staging config, then:

```sh
npx -y firebase-tools@latest deploy --only firestore:rules,firestore:indexes --project lct-collect-staging
npx -y firebase-tools@latest hosting:channel:deploy staging --project lct-collect-staging --expires 30d --no-authorized-domains
```

Direct-load/refresh `/login/`, `/agent/`, `/agent/recent/`, `/agent/history/`, `/viewer/`, `/admin/`. These are emitted Astro routes, not an SPA catch-all. Static HTTP checks do not replace browser interaction or the Android/paper-parallel pilot.

No Analytics, Cloud Functions or Storage service is initialized. Real member exports must not be loaded into staging.

References: [Google GitHub authentication action](https://github.com/google-github-actions/auth), [Firestore locations](https://firebase.google.com/docs/firestore/locations).

## Release integrity and directory reservations

Push deployments check out the triggering commit SHA. Scheduled/manual staging renewals intentionally check out `develop` once and record the resolved commit in the job summary. Production manual runs use their selected event SHA. Firebase CLI is pinned to 15.34.1 for reproducible deployments. The PR CI browser job exercises real application operations against emulators and retains test traces/screenshots for seven days.

Rules now require a matching immutable `accountNumbers/{number}` reservation for member writes. Before enabling production imports against an older directory, upload its current reviewed CSV and use Apply updates: the app explicitly prepares missing reservations for the current directory before changing any accounts. This one-time phase may take a minute for 820 accounts and displays confirmed progress. Duplicate legacy numbers or conflicts stop the import for owner review; never reassign reservation ownership to bypass an error. Empty projects need no backfill. Privileged console/Admin SDK changes must preserve this mapping too. No real production data was modified as part of the UI refinement.

### Multi-account member directory

Deploy the compatible rules before the UI. Directory records now contain separate `uniqueNumber` (LCT member / ABC group) and numeric `accountNumber` (real Ssentezo account). The original full export supplies both; all accounts remain active as before. Existing numeric document IDs stay stable. New records use `acct_<accountNumber>` IDs. A verified original Account Id bridge restores records affected by the earlier LCT-as-account interpretation, requiring the old LCT/ABC value to match the incoming member number. Old reservations remain immutable, and the real account-number reservation must still match. Once present, member ownership and real account number cannot be reassigned. New entries may carry a validated `uniqueNumberSnapshot`; historical snapshots remain immutable. Staging deployment changes no directory data; the owner reviews and applies the full 820-account export. Superseded 715-row member-only files omit valid accounts and must not be used for the full transition.
