---
version: alpha
colors:
  navy: '#192e49'
  primary: '#075b43'
  green: '#075b43'
  text: '#172b49'
  muted: '#526273'
  surface: '#ffffff'
  surface-subtle: '#f5f7f8'
  control-border: '#81909d'
  line: '#dce3e7'
  green-hover: '#064c38'
  danger-hover: '#812131'
  pale: '#edf5f0'
  danger: '#9e2939'
  focus: '#3478a7'
typography:
  sans:
    fontFamily: 'Arial, Helvetica, sans-serif'
    fontSize: '16px'
    lineHeight: '1.5'
rounded:
  panel: '12px'
  control: '7px'
  dialog: '16px'
spacing:
  page: '16px'
  panel: '18px'
components:
  button:
    height: '48px'
  input:
    height: '48px'
---

# LCT Collect

## Overview

An institutional cash notebook for SACCO field agents and office staff in Uganda. Preserve the user's selected main-screen design: navy header, green expected cash, Find member, New entry, explicit account identity. Operate mode: readability outdoors and safe repeated entry outrank decorative expression. No marketing heroes, gradients, floating ornament, or large motion. The Awesome DESIGN.md Linear study informs restrained hierarchy, hairline separation and quiet interaction states, adapted to this established light navy/green product. Its marketing palette and branding are not adopted.

## Colors

Runtime CSS in `src/styles/app.css` owns tokens. Navy is navigation/primary text; green is money and primary actions; muted is secondary guidance; danger is void/discard/validation; pale is selected/success context. The frontmatter records those exact runtime values. Ownership is Model B: canonical `:root` CSS variables → shared controls and surfaces; DESIGN.md mirrors their accepted values. `colors.control-border` maps to `--control-border` (inputs/search/password/currency/outline buttons); `colors.line` to `--line` (passive separators); `colors.surface-subtle` to `--surface-subtle` (disabled controls); hover colors to their identically named variables. Control boundaries have at least 3:1 contrast on white. Disabled buttons remain legible and lose the primary fill; destructive actions retain their danger color on hover. White-on-navy toast actions and header focus outlines remain visible. White is the dominant surface; the existing Bootstrap SVG icon family remains canonical.

## Typography

One familiar sans family; stable rem/px sizing and tabular numerals for financial data. At least 16px in editable fields; 14px body guidance and 12–13px compact record metadata. Secondary information stays distinct without weakening contrast. Cash is the signature, with a smaller UGX label and a readable amount; never clip financial data to fit a card. Kampala date/time, whole UGX and English copy follow domain helpers.

## Layout

Single column collection page, max 620px; office/admin up to 1100px. Collection uses compact labels above full-width 44px currency inputs and paired actions, including at 320px. Header and search remain compact; long identities and zoom may require scrolling. Recent entries use dense rows and a cash-breakdown dialog; directory CSV upload lives in the header with 50-account pagination. Document scrolling stays natural; dialogs scroll internally and retain reachable actions. Safe-area padding and a skip link serve mobile and keyboard users.

## Elevation & Depth

Flat bordered panels. Dimmed native dialog backdrop; no ornamental shadows.

## Shapes

12px panels (`--radius-panel`), 7px controls (`--radius-control`), 16px dialogs (`--radius-dialog`). Pills are status/type filters only.

## Components

`SearchField`, `Modal`, `Account`, `ErrorBoundary`, and `useRecords` are shared owners. `Login` is immediately available; `MemberAdmin` loads on demand. Internal routes retain the mounted app, authentication and unchanged query subscriptions. States use text as well as color, focus rings and >=44px touch targets. Search clearing restores input focus; forms preserve invalid text. Entry success uses a six-second dismissible toast with account and amounts; errors remain visible. Local success follows durable device storage and explicitly says Saved on this device. Confirmed records and pending projections remain distinct; sign-out preserves unresolved work when requested.

## Do's and Don'ts

Show a member/group result with name, unique number and an explicit Group chip for ABC identifiers. In the owner directory, one-account results show the account number directly and have no redundant disclosure; multi-account results show the count and expand for all account numbers. Expand the card to list all separate numeric Ssentezo accounts; the agent selects one before entry. The selected form/review shows the member number and account number. Preserve zeros, wrap long values and keep internal document IDs hidden. Confirm discarding drafts/account switches. Persist drafts and accepted commands separately, isolated by project and user. Keep the chosen navy/green identity across collection, history, office register, owner imports and sign-in. Native select/date popups remain OS-owned; do not fake a custom dropdown. Visual verification uses synthetic emulator accounts only.

Single-account search results select their account in one tap; multi-account results expand for explicit account selection. The viewer uses a compact title/date row, collapsed workday totals, page-local search and paired native status/type filters and no redundant Register navigation. Register reads use 50-entry cursor pages (each saved entry can contain up to three transaction lines); totals come from workday sessions, not the current page. Recording has an in-button busy state and a six-second toast with Undo. The Recorded status filter retains Undo after the toast closes.

Cached working content stays interactive during refresh. Only unavailable sections show loading; there is no eight-second confirmation overlay. History prepares the latest five workdays, while the viewer retains date selection. Shared Pagination displays at most 50 lines from downloaded workday data without dropping multi-line entries. Recording history remains bounded to 40 events.

Minimalist production pass: shared rows have a restrained hover/focus treatment, active navigation exposes aria-current, and financial figures keep tabular numerals. Login associates inline validation with its fields, focuses the first invalid field, masks passwords by default and exposes a named visibility toggle; pending sign-in prevents duplicate submissions. Pagination returns keyboard focus and scrolling to loaded entry results after a user page change. Desktop register status appears once; its time remains visible. CSV preview headings stay visible inside the bounded table scroller. No new navigation destinations, dashboards, decorative cards or financial state changes are introduced.

Brand assets use the supplied Lusaze artwork: a compact white-backed 28px mark beside LCT Collect in the shared Brand component, including sign-in and initial loading. Browser favicons, Apple touch icon and PNG PWA icons share this artwork; the maskable icon keeps it within the central 80% safe zone. Owner directory shows cached results immediately; imports remain online and require a fresh preview.

Account-type and notes update (31 October 2026): agent search no longer expands multi-account results; one tap selects the member/group and displays the account count. Each non-empty amount for such a member requires Fixed or Saving. This is intent, not an assigned real account; the viewer resolves it manually in Ssentezo. Single-account selection remains automatic; the owner directory continues to display individual accounts. A 64px optional entry note appears before review actions; it is immutable with the entry, visible to its agent and the viewer in details. Private agent notes use /agent/notes/, inline creation above newest-first 50-note cursor pages, shared modal viewing, plain text up to 2,000 characters, server-confirmed saves and toast feedback. No completion controls, editing or deletion. Drafts remain in memory and navigation requires discard confirmation; cached viewing is automatic, all writes remain online. Expected cash follows the entry form. Header spacing is reduced while preserving 44px controls, the existing logo, colors and keyboard focus. Login subtitle is Lusaze Community Traders. This current user decision supersedes earlier agent account-expansion/explicit-number selection guidance.

Header/form refinement: agent header keeps Notes directly visible; More contains Recent entries, History and Sign out. Other roles also get More → Sign out. The shared HeaderMenu owns outside-dismiss, Escape/focus restoration, arrow/Home/End keyboard navigation and native menu item semantics; navigation/sign-out keep the existing draft guard. The footer is removed in favour of safe-area bottom padding. Single- and multi-account agent search buttons share a full-width row style. All amount rows show the account-type select, disabled for single-account/no selection; multi-account amount inputs remain disabled until that row has a type. Clearing the type clears the dependent amount to prevent saving stale amounts.

Reminder notes update: loan instalments always show UGX and are enabled once a member is selected; deposit/withdrawal account selection is unchanged. General notes gain up to ten member/group tags, None/Once/Weekly schedules in Africa/Kampala, owner-only editing and completion. Inline controls reveal details on demand. A weekly completion applies to one occurrence, which reopens at the following scheduled occurrence. All upgraded mutations use authenticated server APIs with revision checks and preserve drafts on failure. The existing popup supports viewing/editing; entry notes remain immutable financial snapshots. Direct note links survive login and honour the collection draft guard. Explicit Enable reminders is the only permission-prompt action; previews link to the permanent app for push setup. Notifications show up to 120 graphemes of the validated current note description, without appended member tags. Android uses a transparent monochrome version of the app logo for the small badge; the large icon retains the full-color artwork. Visible reminders close on sign-out/account switches. Due notes remain readable when notifications are unavailable.

Local-first update (November 2026): the approved user decision replaces the
blocking initial overlay and online-only policies above. Keep the established
navy/green visual tokens and layout. Show cached working content immediately,
use section-level loading only for missing data, and never show intermediate
access/sign-out screens during normal transitions. Durable local acceptance
uses "Saved on this device" feedback; only unsynced items show sync labels.

Approved Notes redesign (4 November 2026): Upcoming is a date-grouped agenda with
EAT times, round completion controls, quiet member metadata and a collapsed
Without a reminder section. All notes retains newest-first browsing, including
completed notes. Each list presents at most 50 records after filtering. Keep a
full-width New note action anchored above the safe area. Creation and editing
use the shared Modal's bottom-sheet variant: the original brand header stays
behind a dimmed backdrop, and the sheet contains only the editor. Borderless
18px note text, a live character count and divider-separated Members/Reminder
rows reproduce the approved draft. Both rows disclose their settings inline;
None/Once/Weekly uses a segmented button group, with OS-owned date/time/weekday
inputs. Sheet header and Cancel/Save footer remain outside the internal scroll
region and follow the visual viewport when the keyboard opens. Use the existing
16px dialog radius at the top corners; no new palette or typography tokens.
Delete and complete/reopen actions live in the existing note's action disclosure.
The bell opens notification setup on demand. This supersedes inline creation,
view-before-edit and per-row trash guidance above. Durable local saves, recovery,
revision conflicts, private ownership and unsynced-only indicators remain in force.

Notes sheet refinement (4 November 2026): the user's follow-up changes sheet height
to 90% of the screen, capped by the visible viewport when a keyboard opens.
Member search uses the shared AnchoredResults surface. It chooses above or below
from the usable space between the sheet header/footer and the visual viewport,
repositions during scrolling/resizing, and scrolls long result lists internally.
The popup is portalled inside the native dialog so it remains in the modal's
focus/inert boundary and escapes the body's clipping. The runtime `--z-popover`
token owns its layer. Keep the existing control border, radius and flat surface.
