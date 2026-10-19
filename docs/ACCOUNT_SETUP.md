# Manual account setup

Do this independently in staging and production. Use fictional accounts/data in staging.

1. Enable Authentication → Email/Password in the intended Firebase project.
2. Choose a unique username of 3–32 lowercase letters, digits, `.`, `_`, `-`; the first character must be a letter or digit.
3. Create its Auth user with email `<username>@users.lct-collect.invalid` and a securely delivered password. These are reserved internal identifiers, not contact addresses. Do not use email-reset links for these synthetic identities. Reset passwords through Firebase Console when needed.
4. Copy the Auth UID. In Firestore create `users/{UID}` with:

| Field       | Type      | Example                       |
| ----------- | --------- | ----------------------------- |
| username    | string    | `collector.one`               |
| displayName | string    | `Field collector`             |
| role        | string    | `agent`, `viewer`, or `admin` |
| active      | boolean   | `true`                        |
| createdAt   | timestamp | current timestamp             |

5. Sign in using the **username**, not the internal email.
6. Provision a separate `admin` owner account for the member-import screen. Roles are deliberately separate; `admin` does not grant access to the financial register.

Authentication's unique internal email enforces username uniqueness. Never change a username in only one of Auth and its Firestore profile. Passwords are never stored in Firestore.

Alternatively, after creating the Auth account, configure its profile from a trusted developer machine using Google Application Default Credentials:

```sh
npm run profile:user -- PROJECT_ID AUTH_UID collector.one "Field collector" agent
```

This privileged local script verifies the username/email match and checks duplicate profiles before writing. It never runs in the browser or requires Cloud Functions. Authentication account creation stays manual.

To deactivate someone, set the profile's `active` to false and disable their Auth account in the same project. Active/role checks are enforced by Firestore rules, including for existing Auth sessions. Data already cached on a disconnected device cannot be remotely erased. Logout hides the private UI and attempts to terminate and clear Firestore persistence; other open tabs may prevent cache clearing, in which case the login screen explains the local cleanup needed.
