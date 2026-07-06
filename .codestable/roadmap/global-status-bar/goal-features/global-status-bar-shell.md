# global-status-bar-shell Goal Feature Spec

- Roadmap item: `global-status-bar-shell`
- Depends on: `app-status-summary-store`
- Feature type: mixed
- Design: `.codestable/features/2026-07-06-global-status-bar-shell/global-status-bar-shell-design.md`
- Checklist: `.codestable/features/2026-07-06-global-status-bar-shell/global-status-bar-shell-checklist.yaml`
- Design review: `.codestable/features/2026-07-06-global-status-bar-shell/global-status-bar-shell-design-review.md`
- Review: `.codestable/features/2026-07-06-global-status-bar-shell/global-status-bar-shell-review.md`
- QA: `.codestable/features/2026-07-06-global-status-bar-shell/global-status-bar-shell-qa.md`
- Acceptance: `.codestable/features/2026-07-06-global-status-bar-shell/global-status-bar-shell-acceptance.md`

## Core Runtime Path

Host route layout renders a participating flex footer status bar under `/h/[serverId]/*`, consumes `useGlobalStatusBarView(serverId)`, handles display-only states, owns bottom safe area via bottom chrome context, and keeps root/global routes hidden.

## Mandatory Commands

- `npx vitest run packages/app/src/status-summary/global-status-bar.test.tsx --bail=1`
- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `rg "provider\\.usage\\.list|listProviderUsage|fetchAgents|getStatusSummary|navigateToWorkspace|useUnistyles" packages/app/src/status-summary packages/app/src/app/h/[serverId]/_layout.tsx packages/app/src/app/_layout.tsx`
- `rg "paddingBottom: insets\\.bottom|\\{ paddingBottom: insets\\.bottom \\}" packages/app/src/panels packages/app/src/screens packages/app/src/components`

## Feature DoD

- Status bar is mounted only in host layout, never root layout.
- Footer participates in flex layout, not absolute/fixed overlay.
- Bottom chrome context/helper prevents duplicate safe-area padding for adjacent host bottom consumers.
- Ready/loading/offline/error/unsupported/focus hidden states are implemented.
- No navigation/panel/provider usage/fallback is implemented here.

## Stage Gates And Recovery

- implementation.before_review: run scope-gate, dod-runner, evidence-pack.
- Review blocking returns to implementation review-fix.
- QA failed/blocked returns to implementation qa-fix, then rerun review and QA.
- Acceptance updates checklist checks and roadmap item.

## Evidence Required

- Command outputs.
- Host layout diff evidence.
- Compact safe-area/keyboard manual or screenshot evidence.
- Scope grep and cleanliness evidence.
