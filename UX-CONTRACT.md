# LCT Collect interaction contract

Authoritative business context: README.md (accepted scope/protocol), src/lib/domain.ts (UGX/workday), firestore.rules (permissions and write validation), docs/ACCOUNT_SETUP.md (manual Auth/profile administration), docs/RECOVERY.md and docs/PILOT.md (operations and release gates). Current user decisions permit Cloud Functions for private notes/reminders; daily financial operations use the authenticated sync backend; imports remain online. Use Unique Number for members/groups, retain every distinct Ssentezo Account Number, select members directly, and capture Fixed/Saving intent for multi-account deposits/withdrawals. Loans require no account type. Hide internal account IDs, preserve financial links and provision Auth users manually. This contract records UI consequences of those policies.

| Capability     | Canonical owner                            | Source of truth       | Allowed variants                                                                                    | Verification                        |
| -------------- | ------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Form           | domain amount parser + App collection flow | README.md + DESIGN.md | Parse before state updates; inline errors; preserve invalid text; first invalid field focused       | tests/e2e/app.spec.ts               |
| Select/Listbox | native select                              | README.md + DESIGN.md | OS-owned popup/keyboard behavior accepted for status and agent filters                              | browser keyboard/native select test |
| Date           | native date input + domain date format     | README.md + DESIGN.md | OS calendar accepted; domain workday uses Africa/Kampala; reject blank changes                      | browser viewer test                 |
| Scrollbar      | src/styles/app.css                         | README.md + DESIGN.md | Global visible scrollbar tokens; forced colors use system baseline                                  | narrow viewport and computed styles |
| Toast          | App page feedback + receipt                | README.md + DESIGN.md | Durable local acceptance; persistent critical errors; receipt names account/amount and local status | browser save/recovery test          |
| CRUD           | operations.ts + directory.ts               | README.md + DESIGN.md | Review then explicit save; append-only audit; owner imports preview then explicit apply             | rules + browser suite               |
| Search         | SearchField                                | README.md + DESIGN.md | Local immediate filtering; non-empty clear button; focus returned after clear                       | keyboard browser test               |
| Dialog         | Modal                                      | README.md + DESIGN.md | Native dialog, inert background, latest Escape handler, safe initial focus and focus restoration    | browser modal test                  |
| Navigation     | App protect guard                          | README.md + DESIGN.md | App-owned discard dialog for dirty navigation; native beforeunload only for actual unload           | browser draft test                  |

Searches and financial filter text stay in memory: account names/identifiers must not leak to browser history, copied URLs or referrers. History uses bounded session batches; entries load only for a selected day. Header navigation changes routes inside the mounted app, preserves unchanged subscriptions and cannot silently discard a dirty draft. Back/forward navigation updates the screen and reading context.

Auth persists on personal trusted devices, with memory fallback for limited storage. The IndexedDB repository owns confirmed records, drafts, command payloads and completeness. Saves require durable local storage; online viewing remains available without it. Legacy recovery IDs still need a server check because their missing form payloads cannot be reconstructed.

Changing selected member with entered amounts requires an explicit discard decision. Successful financial mutation clears draft and shows a dismissible six-second toast with account and amounts; saved entries remain available in Recent entries. Uncertain delivery retains and retries the same immutable command ID; server receipts prevent duplicates. Terminal rejections require review and a new linked command. Viewer checks show an immediate audited Undo action. The field estimate is not a member balance.

Directory transactions reserve account numbers for one ID permanently and compare preview fingerprints. Old data must be backfilled before enabling new writes; the explicit import Apply phase prepares existing reservations before applying changes. No number reassignment across IDs, no deletion of omitted accounts, no activation of inactive accounts. Five-account chunks keep rules document-access limits bounded. Partial failure states the confirmed progress and instructs re-preview; it does not assume a timed-out chunk failed.

Directory identity: Account Name and Unique Number identify a member/group; numeric Account Number identifies a separate Ssentezo account. Several accounts can share a member/group number and name. Results group by that number, show account count and expandable account rows, with a Group chip for ABC codes. Search matches names, member/group codes (including ABC 2 without typed spacing) and real account numbers; exact codes rank first. An agent explicitly selects the account before entering money. Admin pagination counts member/group cards. No account is deactivated or deleted for sharing a member number. Only identical duplicate account rows are skipped. Existing record IDs are retained by account-number matching or a verified original-ID bridge for the earlier interpretation. Old financial snapshots remain immutable; new snapshots validate both selected account and optional member/group identity.

Workday downloads use stable createdAt/document-ID ordering and local 50-line pages. Search/status/type/agent filters remain page-local and say so; Previous/Next remain available on zero-match pages. Financial queries stay in memory for privacy. Totals come from sessions plus clearly provisional local changes. Viewer mark/undo records audited commands immediately after local persistence; only unsynced rows show sync state.

The agent's history exposes the latest five saved workdays; this limits offline preparation, not backend retention. The viewer can select any date. Shared Pagination displays at most 50 lines and preserves every line of multi-line entries. Local grouping/search/import previews use 50-result presentation. Cached content stays interactive; uncached scopes show section-level loading or an explicit not-downloaded state. Recording audit remains capped at 40 events.

Minimalist shared refinements: owner single-account members show their account directly, while multiple accounts retain native disclosure. Login validation is field-associated, preserves credentials and focuses the first invalid field; pending sign-in is announced and duplicate submits are blocked. Active header links expose aria-current. Explicit transaction-page navigation focuses and scrolls to the loaded results (including empty filtered results), without moving focus for background snapshots or date/filter edits. Directory paging keeps its existing heading focus. Destructive hover and toast Undo retain accessible semantic contrast. These changes leave permissions, retention and financial transitions unchanged.

Owner directory opens cached results immediately; imports remain blocked until server confirmation. Header branding uses the shared Brand component with fixed image dimensions and decorative image semantics next to the visible app name.

Account-type and notes update (31 October 2026): agent search no longer expands multi-account results; one tap selects the member/group and displays the account count. Each non-empty amount for such a member requires Fixed or Saving. This is intent, not an assigned real account; the viewer resolves it manually in Ssentezo. Single-account selection remains automatic; the owner directory continues to display individual accounts. A 64px optional entry note appears before review actions; it is immutable with the entry, visible to its agent and the viewer in details. Private agent notes use /agent/notes/, inline creation above newest-first 50-note cursor pages, shared modal viewing, plain text up to 2,000 characters, server-confirmed saves and toast feedback. No completion controls, editing or deletion. Drafts remain in memory and navigation requires discard confirmation; cached viewing is automatic, all writes remain online. Expected cash follows the entry form. Header spacing is reduced while preserving 44px controls, the existing logo, colors and keyboard focus. Login subtitle is Lusaze Community Traders. This current user decision supersedes earlier agent account-expansion/explicit-number selection guidance.

Header/form refinement: agent header keeps Notes directly visible; More contains Recent entries, History and Sign out. Other roles also get More → Sign out. The shared HeaderMenu owns outside-dismiss, Escape/focus restoration, arrow/Home/End keyboard navigation and native menu item semantics; navigation/sign-out keep the existing draft guard. The footer is removed in favour of safe-area bottom padding. Single- and multi-account agent search buttons share a full-width row style. All amount rows show the account-type select, disabled for single-account/no selection; multi-account amount inputs remain disabled until that row has a type. Clearing the type clears the dependent amount to prevent saving stale amounts.

Reminder notes update: loan instalments always show UGX and are enabled once a member is selected; deposit/withdrawal account selection is unchanged. General notes gain up to ten member/group tags, None/Once/Weekly schedules in Africa/Kampala, owner-only editing and completion. Inline controls reveal details on demand. A weekly completion applies to one occurrence, which reopens at the following scheduled occurrence. All upgraded mutations use authenticated server APIs with revision checks and preserve drafts on failure. The existing popup supports viewing/editing; entry notes remain immutable financial snapshots. Direct note links survive login and honour the collection draft guard. Explicit Enable reminders is the only permission-prompt action; previews link to the permanent app for push setup. Generic notifications contain no member names or note bodies. Due notes remain readable when notifications are unavailable.

Private notes can be soft deleted using the trash icon at the right of each list row with an app-owned confirmation, safe initial focus and a pending state. The full record is retained in the backend-only deletedNotes archive; active lists and notification links no longer expose it. Successful deletion uses a toast and clamps an emptied final page back to the previous page.

All roles use a coordinated startup shell only when no working context is available. No cached page is made inert for background refresh. Only unsynced work displays sync status. Note deletion starts from a right-aligned list-row trash icon, not the viewing popup. Cancelling returns focus to that icon.

## Local-first daily operations (November 2026)

This approved decision supersedes the online-only, no-drafts, session-only Auth,
and blocking-overlay policies above. The shared IndexedDB repository owns saved
records, completeness, drafts and immutable commands. Firestore is a transport;
local durable acceptance precedes financial success feedback, which explicitly
says "Saved on this device". The sync API validates and atomically commits money
and mutation receipts. Only unsynced work has a synchronization label; acknowledged
work has none. Current financial limits, role restrictions, recording history,
and void eligibility remain in force. Late entry uploads retain their claimed
Uganda workday and carry capture/receipt timestamps and late-review flags.

Login stays mounted until access and destination are ready. Auth restoration,
profile reads, navigation and refresh must not cycle through temporary sign-out
or access-loading pages. Cached content stays interactive. Only missing sections
show loading; first uncached startup has one stable shell. Native date/select,
shared dialogs, focus restoration and draft discard guards remain canonical.

## Approved Notes agenda and bottom sheet (4 November 2026)

The user-approved draft replaces inline composition, view-before-edit, and list-row
trash controls. Upcoming sorts unfinished scheduled notes by occurrence before
50-note pagination, groups by Kampala calendar date (including overdue dates),
and keeps unfinished notes without reminders in a paginated disclosure. All notes
includes completed notes in newest-first order. Switching views resets its page;
removing the last item clamps the page. View state stays in memory for privacy.

The shared Modal owns the modal bottom-sheet variant: native inert background,
focus containment, titled initial focus, Escape/close and focus restoration. The
sheet follows the visual viewport; its body scrolls, while title and Cancel/Save
remain reachable above the keyboard. Members and reminder settings expand inside
this sheet. The reminder kind uses pressed-state buttons; date/time/weekday
popups remain OS-owned. Existing notes open directly in the editor, including
notification/deep links; actions disclose complete/reopen and confirmed soft-delete.
Deletion initially focuses Keep note, which returns to the original action.
Closing or cancelling a dirty editor uses the shared discard guard; refresh
recovers device-persisted text, tags, reminder and edit revision. Successful local
save closes the sheet and restores its trigger; failure retains the sheet and
entered values. Schedule changes reset the projected completion/occurrence using
the same schedule helpers as the server. Mutation/revision protocols are unchanged.
The bell opens notification settings; only Enable reminders requests permission.
Only unsynced notes have sync labels. These rules follow the approved draft and
the existing notes/sync API, with browser evidence in tests/e2e.
