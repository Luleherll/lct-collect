# Recovery and operations

Keep routine backups/exports in the production project's secured infrastructure. Confirm recovery permissions, retention and the last successful export before the pilot. This repository does not configure paid backup services automatically.

Frontend rollback: use Firebase Hosting release history or deploy the previous reviewed artifact built for the **same** project. Firestore rules/indexes must be rolled back explicitly from a tested Git revision; Hosting rollback does not restore them or undo transactions. Check schema compatibility before any rollback.

For a suspected duplicate/uncertain save, find the exact entry ID and its account/amounts before retrying. The app persists only the pending submission ID, not an offline financial queue. Retry the same attempted entry with that ID; do not manufacture a new ID to get past an error.

For a partial member import, re-upload the same CSV, inspect the preview, and apply remaining changes. No absent accounts are deleted. Names in old entries are snapshots. Correct a wrong directory name through another reviewed import. Do not rewrite historic snapshots.

For late errors or a recorded line that cannot be voided, follow the SACCO's office escalation process and correct Ssentezo separately as required. An office undo unchecks only this app's checklist. It does not undo the Ssentezo financial transaction.

If a line reaches its 40-event audit limit, stop further recording changes, preserve its history, and plan a tested migration to append-only audit storage. Do not reset the counter or erase old events in the console to unblock it.

Monitor staging renewal/deployment failures, index build status, permission errors and budget alerts. Set an operational owner for these checks before field use.
