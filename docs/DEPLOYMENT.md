# Deployment and automation

## Current staging deployment

- Firebase project: `lct-collect-staging`.
- Firestore: `(default)`, Standard edition, Johannesburg (`africa-south1`).
- Email/password authentication is enabled. Application users/profiles are still provisioned manually; Google Cloud sign-in does not create an application account.
- Preview: https://lct-collect-staging--staging-5osd9ys7.web.app
- The preview expires on 23 November 2026 unless renewed. Every staging deployment renews it for 30 days.
- Production has not been provisioned or deployed.

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

## Production is separately gated

Use a different Firebase project, database, Auth directory and deploy identity. Do not reuse the staging identity, provider or SDK config.

After staging/pilot acceptance, create a `production` GitHub environment and configure these non-secret variables for that project's Web App and its separate workload identity:

```
PUBLIC_FIREBASE_API_KEY
PUBLIC_FIREBASE_AUTH_DOMAIN
PUBLIC_FIREBASE_PROJECT_ID
PUBLIC_FIREBASE_APP_ID
PUBLIC_FIREBASE_MESSAGING_SENDER_ID
FIREBASE_PROJECT_ID
FIREBASE_DEPLOY_SERVICE_ACCOUNT
GCP_WORKLOAD_IDENTITY_PROVIDER
```

Create a production-specific provider restricted to this repository, `refs/heads/main`, the `production` environment and `deploy-production.yml`, and grant only the needed roles in the production project. Verify its database location, backups and account setup separately. The location recorded in the current shared `firebase.json` was selected for staging; review the production location before provisioning its database.

Set required deployment reviewers and restrict the production environment to `main`. **Only after that setup**, set the **repository-level** variable `PRODUCTION_DEPLOY_ENABLED` to `true`. Its absence disables the production job, including when workflow files first reach `main`. Environment-level variables are intentionally not used for this early job gate.

Production then deploys reviewed pushes to `main` to that project's `live` Hosting channel, with rules/indexes deployed first. `live` is a channel name, not a separate project. No production Firebase project or enabling variable has been configured by this setup.

## Manual staging deployment

Use secure Firebase CLI sign-in, build from the staging config, then:

```sh
npx -y firebase-tools@latest deploy --only firestore:rules,firestore:indexes --project lct-collect-staging
npx -y firebase-tools@latest hosting:channel:deploy staging --project lct-collect-staging --expires 30d --no-authorized-domains
```

Direct-load/refresh `/login/`, `/agent/`, `/agent/recent/`, `/agent/history/`, `/viewer/`, `/admin/`. These are emitted Astro routes, not an SPA catch-all. Static HTTP checks do not replace browser interaction or the Android/paper-parallel pilot.

No Analytics, Cloud Functions or Storage service is initialized. Real member exports must not be loaded into staging.

References: [Google GitHub authentication action](https://github.com/google-github-actions/auth), [Firestore locations](https://firebase.google.com/docs/firestore/locations).
