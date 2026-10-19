# Environment setup and deployment

Staging: `lct-collect-staging`. Production: **not configured**. Use two independent Firebase projects, Auth directories and Firestore databases. A Hosting channel alone is not backend isolation.

Create GitHub environments `staging` and `production` (if supported by the repository plan). In each, set these variables for its own Web App:

```
PUBLIC_FIREBASE_API_KEY
PUBLIC_FIREBASE_AUTH_DOMAIN
PUBLIC_FIREBASE_PROJECT_ID
PUBLIC_FIREBASE_APP_ID
PUBLIC_FIREBASE_MESSAGING_SENDER_ID
FIREBASE_PROJECT_ID
```

Set the environment's encrypted secret `FIREBASE_SERVICE_ACCOUNT` to a dedicated deployment credential scoped to that Firebase project. Configure the required Hosting, Rules and Firestore index permissions; do not grant application users these credentials. The workflows use the credential through Google's authentication action and the Hosting action. Prefer federated identity instead of a stored key where operationally available, updating the workflow accordingly.

Branch flow: feature → `develop` → reviewed promotion to `main`. Configure protected branches and a production deployment approval where supported. If GitHub environments are unavailable, adapt workflows to distinct suffixed repository secrets/variables before deploying; never reuse credentials across environments.

- `develop` deploys rules/indexes, then Hosting to the **staging** preview channel in the staging project. The scheduled job explicitly checks out `develop` and renews the 30-day channel on the 1st and 15th. Monitor failures/expiry; schedules are not guaranteed.
- `main` deploys approved rules/indexes, then production Hosting **live**. Its project must differ from staging and emulator projects. Do not merge into `main` with a configured production environment until staging and pilot gates pass.
- PRs run checks, pure tests, emulator rule tests and a static build using the non-production example config. They receive no deployment secrets.

Before the first deployment, choose the Firestore database location, enable Email/Password Auth and Hosting, and establish a production backup/export process and budget alerts. Create synthetic staging accounts from ACCOUNT_SETUP.md. Configure Auth authorised domains for deployed URLs where needed.

Manual staging deployment, after tests and a staging build:

```sh
npx firebase deploy --only firestore:rules,firestore:indexes --project staging
npx firebase hosting:channel:deploy staging --project staging --expires 30d
```

Check indexes have finished building before declaring staging ready. Direct-load and refresh `/login/`, `/agent/`, `/agent/recent/`, `/agent/history/`, `/viewer/`, `/admin/`. The app uses emitted Astro static routes, not an SPA catch-all.

No Analytics, Cloud Functions or Storage service is initialized. The supplied measurement ID and storage bucket are unused.
