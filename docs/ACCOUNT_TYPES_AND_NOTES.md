# Account types and notes

## Agent collection

Search still groups real accounts by Unique Number. One-account members select their account automatically. Multi-account results show the name, member/group number and account count without listing individual accounts. Each non-empty amount requires Fixed or Saving; these choices do not identify a numeric account. The viewer selects the real account manually in Ssentezo. All money is whole UGX.

The entry form includes an optional plain-text note of up to 2,000 characters. Review includes each account-type choice and note. Recent entries, history details and the viewer show the chosen type; entry notes are shared with the entry's agent and the viewer. These snapshots cannot be edited during recording or voiding.

## Compatibility and integrity

Existing entries and single-account saves retain their actual `accountNumberSnapshot`. No directory changes, account-type import or financial-history backfill is needed.

A multi-account save adds `accountSelection: type`, leaves `accountNumberSnapshot` empty, and stores `accountType: fixed|saving` on every non-empty line. `memberId` remains an internal directory anchor for validating identity, not account attribution. `otherAccountId` must point to a distinct active directory record sharing that anchor's member Unique Number and name. Rules require the correct member snapshot and both active records, prohibit a numeric account snapshot on this path, validate all choices, and keep the existing atomic session totals/recording audit/void protocol. Old entries remain readable and recordable.

## Private notes

`users/{uid}/notes/{noteId}` contains `noteId`, `body` (1–2,000 characters) and server `createdAt`. Only an active agent owning that UID may create or read it. Viewer/admin/other-agent access, anonymous access, extra fields, forged timestamps, updates and deletes are denied. The current feature supports adding and viewing notes only.

The Notes header action opens `/agent/notes/`. Inline creation stays above the newest-first list; clicking a note opens the shared modal. Reads use createdAt/document-ID cursors with 50 documents plus a separate one-document lookahead, so exactly full final pages do not expose an empty Next page. Pending drafts remain in memory, are retained after errors, and use the existing discard/unload guard. A stable per-submission ID prevents accidental duplicate retry saves. All writes are online; confirmed notes cache for offline viewing under the existing sign-out cleanup policy.

## Rollout

Deploy the backward-compatible Firestore rules to staging before testing these saves on the PR preview. Preview Hosting deployments do not deploy rules. After staging verification, merge to develop for permanent staging; a separate develop-to-main release deploys production rules and app together. Production data is not copied from staging. No Cloud Functions or new indexes are required; private-note ordering is covered by Firestore's automatic collection indexes.

The emulator tests exercise owner-only note queries, unauthorized reads/writes, malformed schemas, forged timestamps, oversized notes, denied updates/deletes, invalid/same/unrelated/inactive multi-account references, invalid/missing choices, and preservation of entry notes/types through recording, undo and voids. Browser tests cover the shared notes flow, cached offline reads, mixed account-type collections, viewer note visibility and exact-50 pagination boundaries.
