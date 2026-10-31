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

`SearchField`, `Modal`, `Account`, `ErrorBoundary`, and `useRecords` are shared owners. `Login` and `MemberAdmin` load on demand. Internal routes retain the mounted app, authentication and unchanged query subscriptions. States use text as well as color, focus rings and >=44px touch targets. Search clearing restores input focus; forms preserve invalid text. Entry success uses a six-second dismissible toast with account and amounts; errors remain visible. No financial success precedes server confirmation. Viewed records cache automatically, and sign-out attempts to clear the cache.

## Do's and Don'ts

Show a member/group result with name, unique number and an explicit Group chip for ABC identifiers. In the owner directory, one-account results show the account number directly and have no redundant disclosure; multi-account results show the count and expand for all account numbers. Expand the card to list all separate numeric Ssentezo accounts; the agent selects one before entry. The selected form/review shows the member number and account number. Preserve zeros, wrap long values and keep internal document IDs hidden. Confirm discarding drafts/account switches. Do not persist financial drafts or enqueue financial writes. Keep the chosen navy/green identity across collection, history, office register, owner imports and sign-in. Native select/date popups remain OS-owned; do not fake a custom dropdown. Visual verification uses synthetic emulator accounts only.

Single-account search results select their account in one tap; multi-account results expand for explicit account selection. The viewer uses a compact title/date row, collapsed workday totals, page-local search and paired native status/type filters and no redundant Register navigation. Register reads use 50-entry cursor pages (each saved entry can contain up to three transaction lines); totals come from workday sessions, not the current page. Recording has an in-button busy state and a six-second toast with Undo. The Recorded status filter retains Undo after the toast closes.

Agent loading uses a blocking translucent overlay while waiting for initial server data, without a connecting/cache card. An eight-second connection timeout or offline event releases cached viewing and shows a compact stale-data status; writes still require a server-confirmed connection. Agent history shows at most the five latest workdays, with compact transaction totals and expected cash. A shared Pagination control serves transaction lines, directory/search groups, account sublists, import previews and import errors. Every result page has at most 50 rows; remote cursors resume within multi-line entries so no line is dropped. Recording audit is already bounded to 40 events. The viewer keeps unrestricted date selection; history is not deleted.

Minimalist production pass: shared rows have a restrained hover/focus treatment, active navigation exposes aria-current, and financial figures keep tabular numerals. Login associates inline validation with its fields, focuses the first invalid field, masks passwords by default and exposes a named visibility toggle; pending sign-in prevents duplicate submissions. Pagination returns keyboard focus and scrolling to loaded entry results after a user page change. Desktop register status appears once; its time remains visible. CSV preview headings stay visible inside the bounded table scroller. No new navigation destinations, dashboards, decorative cards or financial state changes are introduced.

Brand assets use the supplied Lusaze artwork: a compact white-backed 28px mark beside LCT Collect in the shared Brand component, including sign-in and initial loading. Browser favicons, Apple touch icon and PNG PWA icons share this artwork; the maskable icon keeps it within the central 80% safe zone. Owner directory loading reuses the agent overlay, eight-second timeout and compact offline fallback.

Account-type and notes update (31 October 2026): agent search no longer expands multi-account results; one tap selects the member/group and displays the account count. Each non-empty amount for such a member requires Fixed or Saving. This is intent, not an assigned real account; the viewer resolves it manually in Ssentezo. Single-account selection remains automatic; the owner directory continues to display individual accounts. A 64px optional entry note appears before review actions; it is immutable with the entry, visible to its agent and the viewer in details. Private agent notes use /agent/notes/, inline creation above newest-first 50-note cursor pages, shared modal viewing, plain text up to 2,000 characters, server-confirmed saves and toast feedback. No completion controls, editing or deletion. Drafts remain in memory and navigation requires discard confirmation; cached viewing is automatic, all writes remain online. Expected cash follows the entry form. Header spacing is reduced while preserving 44px controls, the existing logo, colors and keyboard focus. Login subtitle is Lusaze Community Traders. This current user decision supersedes earlier agent account-expansion/explicit-number selection guidance.

Header/form refinement: agent header keeps Notes directly visible; More contains Recent entries, History and Sign out. Other roles also get More → Sign out. The shared HeaderMenu owns outside-dismiss, Escape/focus restoration, arrow/Home/End keyboard navigation and native menu item semantics; navigation/sign-out keep the existing draft guard. The footer is removed in favour of safe-area bottom padding. Single- and multi-account agent search buttons share a full-width row style. All amount rows show the account-type select, disabled for single-account/no selection; multi-account amount inputs remain disabled until that row has a type. Clearing the type clears the dependent amount to prevent saving stale amounts.
