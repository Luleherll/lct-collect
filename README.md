# LCT Collect

Mobile-first field collection log for Lusaze Community Traders SACCO. Astro static pages, React, TypeScript, Firebase Authentication and Firestore. No Cloud Functions, custom API, analytics, payments integration or offline write queue.

## Current scope

- Username/password sign-in with manually provisioned agent, viewer and owner (`admin`) profiles.
- Agent opening cash, one session per Uganda operational day (02:00–02:00), member account search, grouped deposits/withdrawals/loan instalments, review, idempotent save and eligible per-line voids.
- Own session history and a separate recent entries page.
- Office date register with composable search/type/agent/status filters, independent recording checks and audited undo.
- Owner CSV import with preview. Uses **Account Id**, **Account Number**, **Account Name** only. No deduplication by name; account ID is the document key.
- Trusted-device read cache and a static-only service worker; all application writes use online transactions.
- Emulator security tests and isolated staging/production workflow definitions.

## Staging preview

https://lct-collect-staging--staging-5osd9ys7.web.app

Staging uses Standard Firestore in Johannesburg. See [deployment setup](docs/DEPLOYMENT.md) for keyless GitHub auto-deploy activation and [account setup](docs/ACCOUNT_SETUP.md) for manually provisioning application access.

## Local development

Node 22+ and Java 21 are required. Java is used only by the Firestore emulator.

```sh
npm ci
cp .env.example .env
npm run dev
```

The provided public configuration selects **lct-collect-staging**. It does not grant administrative access. Enable Email/Password Authentication, create Firestore and deploy tested rules before using a real project. No production project has been configured.

### Explore with fictional emulator data

In three terminals:

```sh
# Terminal 1
npm run emulators

# Terminal 2, once emulators are ready
npm run seed:emulators

# Terminal 3
npm run dev:emulators
```

Open the URL Astro prints. Local-only accounts: `demo.agent`, `demo.viewer`, `demo.admin`; password `CollectDemo123!`. The seed script accepts only loopback emulator hosts and the `demo-lct-collect` project. It never writes to staging or production. Re-running it keeps an existing demo session.

### Checks

```sh
npm run check
npm run test
npm run test:rules
npm run build
```

`npm run test:ci` runs unit and emulator security suites. Tests cannot select the real Firebase project. The service worker is generated at build time and precaches only emitted static app resources; Firestore requests are excluded.

## Accounts and owner imports

Follow [account setup](docs/ACCOUNT_SETUP.md). Creating an Authentication user alone is insufficient: a matching active `users/{uid}` document assigns access. User/profile writes are never available from the web app. The owner imports members at `/admin/`; it does not create Authentication users. Agents and viewers cannot import. Owner accounts cannot read financial records unless separately given an appropriate financial account.

Import the **CSV** export supplied by Ssentezo. Native `.xlsx` files are not accepted in this version; export them to CSV first. IDs and account numbers stay strings, including leading zeros. The preview rejects missing fields, duplicate IDs, scientific-notation identifiers and account-number collisions. Apply updates is explicit and online. Existing accounts absent from an upload remain. Previously inactive accounts remain inactive. Names and numbers in existing transactions never change.

Imports run in chunks of 50 online transactions. A file is not one 820-row atomic operation. If connectivity fails partway through, some chunks may have committed; re-upload the same file and review remaining additions/updates. Only changed rows are written.

## Important protocol details

- One entry stores up to three lines. Session aggregates and entry changes must commit together, linked by `lastMutationId` and the entry's `financialRevision`.
- Viewer changes preserve `financialRevision`, amounts, identity and session totals. Audit events use a bounded revision-keyed map so each event can receive a server timestamp and older events cannot be rewritten.
- Recording history allows 40 transitions per line. Further changes stop with an owner escalation message. Migrate audit storage before changing that limit; never truncate old events.
- Opening cash and each line currently have a UGX **100,000,000** cap, with separately bounded aggregates. Confirm this operating limit before a live pilot; change both client constants and rules together.
- Failed/uncertain saves retain the submission ID, including across refreshes. No financial form payload is saved as an offline queue. Reconnect and check the same ID before retrying. A restored ID does not restore its form inputs.
- Security rules validate the data and atomic relationships; they cannot establish which SDK method a modified client used. The official app exclusively uses `runTransaction()` for writes.
- Cash is a field estimate, not a member savings balance or withdrawal entitlement. Corrections discovered after expiry/recording require SACCO office escalation; there is no historical edit workflow.

## Deployment and release status

See [deployment](docs/DEPLOYMENT.md), [recovery](docs/RECOVERY.md), [pilot checklist](docs/PILOT.md), and [design verification](design-qa.md). The supplied screenshot is the main-screen target; navy/green styling carries through all routes.

Do not treat a successful build or emulator run as field acceptance. Browser visual QA, real small-Android checks, staging account verification, and the notebook-parallel pilot are release gates. No Firebase deployment credentials, real member exports or production records belong in this repository.
