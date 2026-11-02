# Cahootz mobile design contract

This is the approved system, not a suggestion to redesign the app. Read this alongside the root AGENT.md and TESTING.md. User instructions override it.

## Source of truth

Use `constants/design.ts` for new or touched shared colors and dimensions. Use the existing app typeface and `components/ui/text.tsx`; do not introduce a new font or a page-specific palette. `DetailHeader` and `LoadError` are shared patterns. Older screens are migrated incrementally; do not restyle unrelated workflows as part of a small task.

- White main canvas, dark ink, quiet gray borders, orange primary actions.
- Pastel green, lavender, blue, and warm orange are accents for identities and categories, not full-page themes.
- Page gutters 20px, controls at least 44px (standard primary control 48px), rounded cards around 16px.
- Page headings about 28–30px; section headings 16–18px; readable body copy 14–16px. Weight establishes hierarchy; do not bold everything.
- Use compact labeled forms, following the unified sign-in form. Keep errors near the relevant control and preserve typed input on failure.
- Use emoji or initials where imagery is absent. Never reserve a large empty photo/cover slot. Real product image galleries must keep working.

## Explicit product decisions

**Commons home stays a two-column CIRCLE grid, not a list of rows.** Round pastel avatars, full wrapping names below, separate Your circles and Discover circles. Search filters visible circles without changing membership. Keep menu, commons switcher, default star, top-right Manage circles, invitations, joining, counts, and the welcome lounge. Do not remove a real action because a mockup omitted it.

Root tabs are Commons, Board, Alerts, You. Descendants retain the relevant selected tab (products under Board, Wallet under You). Onboarding and signed-out/no-membership states must still hide tabs. Detail headers have a consistent back action and parent context; preserve actual history/fallback behavior.

Keep cart, quantity, inventory restrictions, sale prices, seller links, reward disclosures, image galleries, and checkout routes when changing product layout. No cosmetic cleanup may weaken financial confirmations or membership boundaries.

Loading, empty, and failed are different states. Use LoadError with a real retry. Never show invented zero counts or an empty success state when a request failed. Keep existing data on refresh failure where supported. Fix missing local migrations rather than disguising a backend error.

## Required workflow for humans and LLMs

1. Inventory the screen's controls, handlers, role restrictions, and empty/loading/error states before editing.
2. Reuse the shared components/tokens. Preserve the controls inventory after editing. Call out intentional removals for approval.
3. Keep existing copy intent and data; never invent counts, names, rewards, or successful actions.
4. For behavior/UI regressions, add a real Playwright journey in `e2e/`; update TESTING.md. Verify keyboard labels, long names, scrolling, and widths 320/375/414/768.
5. Run mobile type-check and relevant E2E coverage; report failures and untested flows honestly. Capture actual final UI, not only a mockup.

## Review checklist

- Manage circles remains visible and opens circle management.
- Search, switcher, menu, General, existing circles, and joining still work.
- Long names wrap and avatars stay round; no clipped emoji.
- Bottom tab selection follows the parent and never appears during onboarding.
- Product with/without image, cart/quantity, availability and navigation remain functional.
- Error recovery restores actual data; no raw server detail reaches members.

LLMs do not follow a document with certainty. These rules plus shared components and executable UI regressions are the enforcement layers. Link this file in any tool's custom instructions that does not automatically read AGENTS.md.

## Secondary screens

Alerts uses a horizontally scrollable category strip, quiet unread emphasis, and a pastel Sage suggestion row. Preserve every category, refresh, mark-read, pagination, and destination. Directory cards use wrapping names and secondary membership badges; search has a clear action when no results match. EmptyState is for successful empty results only. Settings put the usable preference before expandable explanatory material; essential privacy and failure notices remain visible. Forms use sentence-case labels, 48px choices, and readable orange action contrast; do not drop optional fields or validation.

Onboarding uses the same ink, muted text, borders, and orange actions, with dark primary-button labels for contrast. Profile questions use simple labeled fields and a centered 640px reading width. Preserve the carousel, email/code verification, profile/invite/commons sequence, completion checks, and family setup. A visual consistency pass must not change those routes or eligibility rules.
