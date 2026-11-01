# Account types and notes

Current account-selection and note behaviour. Backend scheduling, notification privacy, provisioning and acceptance checks are described in [REMINDERS.md](REMINDERS.md). Current rollout status is in [DEPLOYMENT.md](DEPLOYMENT.md).

## Agent collection

Search still groups real accounts by Unique Number. One-account members select their account automatically. Multi-account results show the name, member/group number and account count without listing individual accounts. For multi-account members, deposit/withdrawal inputs stay disabled until their Fixed/Saving type is chosen. Loan instalments use a UGX adornment and are enabled as soon as a member is selected, with no account type required. For single-account members, deposit/withdrawal type selectors stay visible but disabled. Fixed/Saving choices do not identify a numeric account. The viewer selects the real account manually in Ssentezo. All money is whole UGX.

The entry form includes an optional plain-text note of up to 2,000 characters. Review includes each account-type choice and note. Recent entries, history details and the viewer show the chosen type; entry notes are shared with the entry's agent and the viewer. These snapshots cannot be edited during recording or voiding.

## Compatibility and integrity

Existing entries and single-account saves retain their actual `accountNumberSnapshot`. No directory changes, account-type import or financial-history backfill is needed.

A multi-account save adds `accountSelection: type`, leaves `accountNumberSnapshot` empty, and stores `accountType: fixed|saving` on non-empty deposit/withdrawal lines. New loan lines omit `accountType`; older loan lines carrying a type remain supported. `memberId` remains an internal directory anchor for validating identity, not account attribution. `otherAccountId` must point to a distinct active directory record sharing that anchor's member Unique Number and name. Rules require the correct member snapshot and both active records, prohibit a numeric account snapshot on this path, validate all choices, and keep the existing atomic session totals/recording audit/void protocol. Old entries remain readable and recordable.

## Private notes

`users/{uid}/notes/{noteId}` stores the active agent’s private note, tags, reminder configuration, completion and server-controlled revision/schedule metadata. Only its owning active agent can read it. New creates, edits, completion and soft deletion use authenticated backend APIs that enforce ownership, validation, idempotency and revision checks. Legacy clients may still create ordinary text notes through the restricted Firestore create rule; direct updates/deletes and client access to delivery/device/archive records are denied. Tags never share notes with members, viewers, admins or other agents.

A trash icon at the right of each note row opens a confirmation with safe initial focus, a pending state and a success toast. The viewing popup has no delete action. Soft deletion retains the full record in `users/{uid}/deletedNotes/{noteId}`, records deletion metadata, clears its due schedule and removes it from active queries. Stale reminder tickets are rejected, older clients cannot recreate the note, and deleting the last item on a later page returns to the preceding page. There is no trash/restore screen.

The Notes header action opens `/agent/notes/`. Inline creation stays above the newest-first list; clicking a note opens the shared modal. Reads use createdAt/document-ID cursors with 50 documents plus a separate one-document lookahead, so exactly full final pages do not expose an empty Next page. Pending drafts remain in memory, are retained after errors, and use the existing discard/unload guard. A stable per-submission ID prevents accidental duplicate retry saves. All writes are online; confirmed notes cache for offline viewing under the existing sign-out cleanup policy.

## Rollout

Deploy the backward-compatible Firestore rules to staging before testing these saves on the PR preview. Preview Hosting deployments do not deploy rules. After staging verification, merge to develop for permanent staging; a separate develop-to-main release deploys production rules and app together. Production data is not copied from staging. Private-note list ordering uses automatic collection indexes; reminder dispatch additionally needs its deployed collection-group/delivery indexes, isolated runtime identity, signing secret and scheduled Functions. See the reminder runbook for environment-specific prerequisites.

The emulator tests exercise owner-only note queries, unauthorized reads/writes, malformed schemas, forged timestamps, oversized notes, denied updates/deletes, invalid/same/unrelated/inactive multi-account references, invalid/missing choices, and preservation of entry notes/types through recording, undo and voids. Browser tests cover the shared notes flow, cached offline reads, mixed account-type collections, viewer note visibility and exact-50 pagination boundaries.
