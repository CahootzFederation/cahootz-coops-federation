# Cahootz design direction

Approved direction: a simpler, calmer experience for the mobile app and public site. Use white backgrounds in the app; retain the public landing page’s warm brown/paper palette and preserve the community identity, existing routes, and plain neighbor-to-neighbor language.

## Shared system

- App page backgrounds and card surfaces are white. Do not introduce cream, tan, beige, or brown app backgrounds without an explicit request. The public landing page is an explicit exception: preserve its warm brown/paper backgrounds. Use dark terracotta for actions and selection, dark neutral text, and a readable muted gray for secondary text. Mobile semantic tokens live in `apps/mobile/constants/theme.ts`; NativeWind equivalents are appended to `apps/mobile/global.css`. The public site retains its existing `apps/web/tokens.css` warm palette and editorial serif headings.
- The mobile app is a centered, single-column workspace, at most 800 pixels wide. Small screens retain their full available width. Preserve native safe areas and scrolling.
- Keep section headings bold, everyday labels semibold, and explanatory text regular. Avoid treating every reminder as a primary action.
- Use at least 44-pixel targets for navigation and composer controls. Welcome cards advance only when the reader asks. Keep focus styles and visible control labels.
- Keep the selected Commons in navigation links. Account identity is account-wide; the Board and proposals are Commons-specific.

## Page hierarchy

Circles retain their recognizable colors with smaller, flat icons and two-line names. The feed emphasizes conversation, with a quiet profile reminder. Account navigation follows the identity card, ahead of wallet and supporter details. Proposals use a quiet bordered creation card. The public site keeps membership front and center, with business signup and funding explanations in explicit disclosures, and no floating duplicate download prompt.

An unavailable application list must explain whether it is empty or failed to load. Retry belongs to the error state; the empty state links to finding or starting a Commons. Neither state should offer an impossible Continue action.

## Verification

Review running screens at 375, 768, and 1280 pixels, with narrow-width spot checks. Keep mobile type checking and end-to-end UI tests in the implementation workflow; see `TESTING.md`. Mobile web verification does not replace an iOS/Android device pass.

### Implementation verification — 2026-11-02

The final app palette is white; the public landing page retains its warm paper/brown palette. The local Hallmark skill records the app preference and preserves landing-page palettes separately.

Mobile type checking passes. Twelve focused checks passed after the layout changes; all four design regression checks passed again after the final palette correction.

The broader mobile run was not clean: 76 passed, 43 failed, 2 skipped, and 3 did not run. It was disrupted by development-server timeouts, memory exhaustion and restarts; other failures include admin-fixture setup and broader workflow checks. Do not treat it as release qualification. The website type check also reports errors outside the edited files. Native iOS/Android device verification remains outstanding.

## Calm app follow-up

The isolated `codex/calm-app-fixes` worktree continues the approved white-app direction. Messages now uses a vertical conversation list and separate member picker; Proposals prioritizes voting needs and drafts and separates current decisions from history. Validation stays beside Send, with inline field feedback. Account detours retain Commons context. Marketing-site colors remain unchanged.

## Integration with current main

The approved `apps/mobile/DESIGN.md` contract and `constants/design.ts` are the shared source of truth. CommunityTheme delegates its colors to those tokens. Preserve full wrapping circle names, circle search, parent-tab selection, and main’s sign-in restoration fixes. The community homepage keeps its warm palette and single waitlist; group-buy remains the default homepage.
