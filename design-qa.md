# Design verification

Target: the user's revised option 3. Preserve the navy header, green expected cash, separate Find member/New entry panels, and explicit member name and LCT account number. Refinement uses Design Partner compact operator layouts alongside the earlier Impeccable Operate/adapt/harden guidance and the maintained DESIGN.md/UX-CONTRACT.md.

Browser verification was performed on 24 October 2026 using Chromium against a compiled static app with local Firebase emulators and 820 synthetic accounts. No real SACCO data was used. Viewports included 320×760, 390×740, 390×844 and 1280×900. Screenshots were saved and inspected in `/workspace/lct-ui-evidence/` for collection, long identifiers, review, history and the viewer register. The original layout was captured before refinement for comparison.

Verified behavior: amount validation does not unmount the form; account changes and navigation protect the draft; full-width mobile amounts fit the maximum input; saved-entry toasts contain account/amount and auto-close; actual save and void update the log; viewer recording and audited undo work; imports reserve numbers, display changes and stop stale previews; blocked storage falls back to memory sign-in and blocks financial submission; offline and workday rollover block writes; pending references recover the saved entry. Thirteen project-owned browser scenarios cover these flows, including directory pagination, header upload placement, numeric-only edits, viewport fit, retained app navigation, cash-breakdown dialog, automatic cache across reload with database requests blocked, and toast dismissal. CI retains failure traces and captures for seven days.

Static checks: Astro diagnostics, domain/import and generated-worker tests, Firestore rules tests, the Auth/query smoke checks, and the production static build. The strict premium contract audit reports zero violations. DESIGN.md lint reports zero errors; unused documentation token warnings are advisory. The generated service worker handles known static GETs only and caches owner code when first requested.

Remaining acceptance: a physical small Android phone, its actual numeric keyboard and browser chrome, text zoom and assistive-technology testing, staging user/profile verification, first trusted-branch federated deployment, and the paper-parallel pilot. These are not established by desktop browser emulation. Production Hosting has not been deployed by this refinement.

After a release, close existing LCT Collect tabs and reopen to activate an installed app-shell update if an older version remains visible. Do not clear site data while an uncertain save still needs checking.

Multi-account update (25 October, Kampala): shared member cards group all distinct Ssentezo accounts under a LCT member or ABC group identifier. Accounts expand below the result, and an agent selects the target before entry. Both admin and agent results show the Group chip for ABC codes. Member/group and account searches preserve formatting and zeros; exact identifiers rank first. Import validation of the supplied private export reports 715 members/groups, 820 accounts and 7 ABC groups with no discarded accounts. Original-ID restoration and financial snapshot validation protect earlier records. Browser evidence uses synthetic accounts only.

Viewer refinement (25 October, Kampala): single-account agent results select directly; multiple-account results retain explicit choices. The viewer removes redundant Register navigation, compacts its title/date/filters and transaction rows, collapses daily totals, and hides the agent control for a single agent. Totals use workday session aggregates independently of the entry page. Register reads now use 50-entry cursor queries ordered by creation time and document ID; each entry may contain multiple transaction lines. Search and filters are explicitly page-local. Next/Previous remain usable when a page has no matching lines. Recording exposes an in-button loading state and an auto-closing toast with audited Undo; the separate success receipt is removed. The new Firestore index must be ready before releasing this client.

Verification for this refinement: 15 compiled Chromium browser scenarios passed with 820 synthetic accounts, including mark/Undo loading, one-tap selection, 50-entry boundaries, empty filtered pages, date resets and 320px reflow. The touched viewer and compact collection scenarios were rerun after final UI changes. All 25 unit/worker tests, 34 rules tests, three role Auth/query smoke checks, Astro diagnostics, formatting and static build passed. Strict premium audit: zero findings. Physical mobile keyboard and screen-reader verification remain outstanding.

Agent/history and shared-list refinement (25 October, Kampala): agent loading uses an announced blocking overlay, with an eight-second fallback to a small stale-data status instead of an initial connecting card. Fresh server data clears that status; writes remain blocked offline. History queries return only the five latest workdays and show compact amounts/expected-cash cards. Historical entry navigation puts All sessions opposite Back to collection. Shared Pagination is used by agent search, account sublists, directory results, import previews, validation issues and all transaction pages. Every page contains at most 50 displayed results. Transaction cursors resume within multi-line entries and fetch at most 50 documents; the current collection screen does not fetch an unused transaction list. The viewer can still select any date. The 40-event audit and five-workday history are already below the page limit.

Verification: all 17 compiled Chromium scenarios passed in a freshly started local emulator with 820 synthetic accounts. Coverage includes the loading overlay without a connecting card, timeout/cache fallback, five-workday maximum, search paging, aligned history links, import preview/error paging, and 165 unique transaction lines across 50/50/50/15 pages without omissions or duplicates. Mobile history/card screenshots were inspected. All 25 unit/worker tests passed; Astro diagnostics, formatting, static build and the strict UI audit pass. Both required staging transaction indexes were confirmed READY. Existing financial/security rules are unchanged. Physical phone and assistive-technology acceptance remain outstanding.

Minimalist whole-app pass (25 October, Kampala): Awesome DESIGN.md's Linear study informed restrained hierarchy and quiet bordered surfaces, adapted to the established navy/green identity. No routes or financial features were added. One-account owner rows expose their account number directly; multiple accounts retain expansion and Group chips. Search hints fit phones. Active navigation exposes its current-page state; explicit entry paging restores focus and scrolls to loaded results. Login errors are field-linked, focus the invalid input and preserve credentials; pending sign-in blocks resubmission. Import selection is blocked during an active apply, and preview headers remain visible in their scroller.

| Design rule / issue                 | Evidence before pass                                 | Resolution                                                                                               |
| ----------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Readable control boundaries         | Old control border had 1.74:1 contrast against white | Canonical control-border token now has 3.28:1 contrast; passive dividers remain quiet                    |
| Semantic destructive actions        | Generic primary hover turned danger buttons green    | Dedicated danger hover token preserves intent                                                            |
| Readable toast actions              | Green Undo against navy had 1.69:1 contrast          | White action text has 13.74:1 contrast                                                                   |
| Minimal directory interaction       | Every single account required a disclosure           | Static single-account rows show the account directly; multi-account disclosure remains                   |
| Consistent shapes / token ownership | Duplicate literals and later overrides               | Runtime CSS remains canonical; control/panel/dialog radii and shared palette map explicitly to DESIGN.md |
| Clear register status               | Both inline and column status appeared on desktop    | Desktop keeps one status column and the entry time; mobile retains inline status                         |

Before/after screenshots cover sign-in, collection, Recent entries, workdays, viewer and owner at 390px and 1280px in `/workspace/lct-ui-evidence/minimal-pass/`, using synthetic emulator records. Automated accessibility coverage is maintained in `tests/e2e/app.spec.ts` for 320px and desktop screens and the review dialog. Automated checks supplement physical-phone and assistive-technology acceptance; they do not establish it.

Validation for this pass: all 21 compiled browser scenarios passed against a clean 820-account emulator seed, including the screen-by-screen accessibility matrix. After the final dialog button-order and result-region refinements, nine focused collection/draft/recording and accessibility cases passed again. Accessibility coverage is now split into six separately reported role/viewport cases (26 total scenarios in CI). All 25 unit/worker tests, 46-file Astro diagnostics, formatting and the static build pass. The strict UI audit has zero findings, and DESIGN.md lint has zero errors (unused mirrored-token warnings only). No financial/security rules changed. The existing large Firebase bundle warning and physical Android/screen-reader acceptance remain outstanding.

## Approved Notes agenda and sheet — 4 November 2026

Source visual truth: the user's approved combined agenda + bottom-sheet drafts:
`/workspace/generated_images/exec-c03cb1fd-8065-4f6e-a56b-c6e9e717a1fc.png`
(agenda), `exec-16b335e5-abcf-41ec-8753-b49ea2af5e29.png` (new note), and
`exec-876e5630-1ac8-4f58-b04f-1523cd6e0ab4.png` (expanded weekly reminder).
All source images are 852×1846 pixels. They were normalized to a 390×844 CSS
viewport for comparison with 390×844 Chromium captures at deviceScaleFactor 1.
App content only; neither source nor implementation includes a device frame.

Implementation evidence, committed for review:

- [Agenda](docs/design/notes/agenda.png)
- [New note sheet](docs/design/notes/new-note.png)
- [Weekly reminder sheet](docs/design/notes/weekly-reminder.png)

Full-view comparison boards place normalized source and implementation together
in `/tmp/lct-notes-agenda-comparison.png`, `/tmp/lct-notes-sheet-comparison.png`
and `/tmp/lct-notes-weekly-comparison.png`. Both sides were opened and inspected.
At this normalized size the typography, counters, member rows, reminder inputs
and persistent footer are readable without a separate magnified crop.

Comparison history:

| Earlier finding                                                                                                 | Fix                                                                                                                | Post-fix evidence                                                        |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| P2: sheet covered too much of the agenda                                                                        | Match the approved sheet's approximately two-thirds height; follow the visual viewport                             | New note and weekly captures above                                       |
| P2: future rows unnecessarily repeated the time column and displaced the undated section                        | Keep today's time column; put future times in metadata and tighten agenda spacing                                  | Agenda capture; all groups and the undated disclosure fit above New note |
| P2: focusing a weekly input scrolled note text out of the comparison state; expanded controls crowded the sheet | Compact the editor when options expand, retain the full text, and use a scrollable body with a fixed header/footer | Weekly capture at scroll start; short-viewport interaction test          |
| P1: native Tab at the final control could leave focus on browser chrome                                         | Extend shared Modal with explicit first/last control cycling                                                       | Keyboard test at 320×400; shared modal browser suite                     |

Required fidelity surfaces:

- **Fonts and typography:** existing Arial/Helvetica stack, 15px semibold agenda
  subjects, 18px editable text and clear title/metadata hierarchy. Text and member
  names wrap safely. No additional font download or font swap. The longest sample
  agenda subject occupies two lines with the platform scrollbar gutter; this is
  P3 variation in wrapping, with every section still visible.
- **Spacing and layout rhythm:** plain rows and dividers, anchored New note,
  rounded sheet top, internal disclosure panels and persistent actions match the
  chosen composition. The current app's compact identity/navigation header is
  intentionally retained. Short viewports scroll the body instead of clipping
  Save or Cancel. No animation or intermediate screen delays opening the editor.
- **Colors and tokens:** runtime navy/green/white tokens remain canonical. Native
  inputs retain the established accessible control border; passive dividers stay
  quiet. Source image shading is not copied into new gradients or token values.
- **Image quality and assets:** the existing Lusaze brand PNG is reused at a fixed
  size. Icons use the app's Bootstrap Icons family, including the newly added
  bell/calendar/chevrons/plus. No generated page raster is used as interface code.
- **Copy and content:** sample member names and note bodies are synthetic. The
  live counter correctly reports 50 characters for the sample text (the generated
  mock's 67 is inaccurate). New notes start without a reminder; the collapsed
  capture deliberately shows that default instead of preassigning the mock's
  example reminder. Weekly controls use Friday, 9am, EAT as in the approved state.

Verified workflows use local Firebase emulators and 820 synthetic accounts only:
create/edit, ten-member tagging controls, Once/Weekly settings and invalid past
reminder recovery, complete/reopen followed by another save, confirmed soft-delete,
50-note pagination and final-page clamping, local offline mutations and reconnect,
text-only and metadata draft recovery, dirty close/Cancel, deep links with another
saved edit, notification settings, focus containment/restoration, and long text.
Automated axe checks cover the page and expanded sheet. Viewports include 320×740,
390×844, 320×400 and 1280×900. The browser design test records page errors and
asserts none. The full shared-screen suite also passed before the final Notes
refinements, with the seven affected Notes cases rerun afterward.

The expanded workflow exposed a pre-existing backend map-merge bug when switching
reminder kinds. Firebase note writes now replace the reminder map, preserving
other record fields, and repair obsolete stored schedule keys on a validated edit.
A server regression test checks repeated edits, kind changes and legacy repair.

No actionable P0/P1/P2 visual findings remain. Physical Android/iOS keyboards and
assistive technology remain device acceptance checks; desktop emulation does not
establish those. Existing Firebase bundle-size warnings remain outside this Notes
change. No production deployment or merge is part of this pass.

final result: passed

Final verification: 48 unit/worker tests; 16 Firebase notes/sync API tests; all
39 browser scenarios before final Notes refinements; all seven affected Notes
browser scenarios after the final UI and reminder fix. Astro checking, application
and Functions builds, formatting and the strict UI contract audit pass. The only
Astro hints are the existing Firebase Messaging deprecations.

## Notes sheet and member-result follow-up — 4 November 2026

The user's latest instruction supersedes the earlier two-thirds-height image:
make the sheet 90% tall and place member results in whichever direction has usable
space, including above the field when the keyboard covers the bottom.

Browser-rendered evidence at 390×844, deviceScaleFactor 1:
[90% sheet](docs/design/notes/new-note.png),
[weekly settings](docs/design/notes/weekly-reminder.png),
[results below](docs/design/notes/member-results-below.png), and
[results above](docs/design/notes/member-results-above.png).
The above-results capture models a 450px visual viewport within the 844px layout
viewport; the remaining dimmed area is the simulated keyboard area, not a physical
keyboard capture. Both directions and the resized sheet were opened and visually
inspected. Brand assets, typography, colors and field spacing retain the approved
system. The explicitly requested sheet height is the intentional image deviation.

AnchoredResults measures the visible viewport and dialog header/footer boundaries,
uses the larger available side, and constrains its own scroll height. It renders
inside the native dialog, outside its scrolling body, to avoid clipping and retain
modal focus containment. Scroll/resize observers update placement without fetching
or delaying local search. SearchField exposes the results relationship. Arrow
keys reach matches; Enter selects without submitting the note; Escape dismisses
results before the sheet and restores search focus. Outside focus/pointer and
clearing/selecting dismiss results. Search pagination cannot submit the form.

The original 39 browser scenarios pass with the new code. The new placement case
passes separately after correcting its test locator to distinguish the populated
search box from its Clear button. It checks the 90% height, both directions,
header/footer bounds, visual-viewport keyboard resizing, short 320px layout,
keyboard selection/dismissal, no-match state, outside dismissal, member paging
without submission, and axe accessibility. All 48 unit/worker tests, Astro
checking, the application build and strict UI audit pass. Physical mobile keyboard
and assistive-technology acceptance remain as previously recorded.

No actionable P0/P1/P2 findings remain for this follow-up.

final result: passed
