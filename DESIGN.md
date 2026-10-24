---
version: alpha
colors:
  navy: '#192e49'
  primary: '#075b43'
  green: '#075b43'
  text: '#172b49'
  muted: '#526273'
  surface: '#ffffff'
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

An institutional cash notebook for SACCO field agents and office staff in Uganda. Preserve the user's selected main-screen design: navy header, green expected cash, Find member, New entry, explicit account identity. Operate mode: readability outdoors and safe repeated entry outrank decorative expression. No marketing heroes, gradients, floating ornament, or large motion.

## Colors

Runtime CSS in `src/styles/app.css` owns tokens. Navy is navigation/primary text; green is money and primary actions; muted is secondary guidance; danger is void/discard/validation; pale is selected/success context. The frontmatter records those exact runtime values. White is the dominant surface; the existing Bootstrap SVG icon family remains canonical.

## Typography

One familiar sans family; stable rem/px sizing and tabular numerals for financial data. At least 16px in editable fields, 14px for secondary guidance. Cash is the signature, with a smaller UGX label and a readable amount; never clip financial data to fit a card. Kampala date/time, whole UGX and English copy follow domain helpers.

## Layout

Single column collection page, max 620px; office/admin up to 1100px. At <=600px, amount labels sit above full-width 56px currency inputs. At <=360px actions stack with primary action first. Document scrolling stays natural; dialogs scroll internally and retain reachable actions. Safe-area padding and a skip link serve mobile and keyboard users.

## Elevation & Depth

Flat bordered panels. Dimmed native dialog backdrop; no ornamental shadows.

## Shapes

12px panels, 7px controls, 16px dialogs. Pills are status/type filters only.

## Components

`SearchField`, `Modal`, `Account`, `ErrorBoundary`, and `useRecords` are shared owners. `Login` and `MemberAdmin` load on demand. States use text as well as color, focus rings and >=44px touch targets. Search clearing restores input focus; forms preserve invalid text. Feedback includes account and amounts, and no financial success precedes server confirmation.

## Do's and Don'ts

Keep account ID and number as strings; allow long identifiers to wrap. Confirm discarding drafts/account switches. Do not persist financial drafts or enqueue financial writes. Keep the chosen navy/green identity across collection, history, office register, owner imports and sign-in. Native select/date popups remain OS-owned; do not fake a custom dropdown. Visual verification uses synthetic emulator accounts only.
