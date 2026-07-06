# status-bar-polish-hardening Goal Feature Spec

- Roadmap item: `status-bar-polish-hardening`
- Depends on: `global-status-bar-shell`, `status-bar-running-sessions-nav`, `usage-history-persistence`
- Feature type: mixed
- Design: `.codestable/features/2026-07-06-status-bar-polish-hardening/status-bar-polish-hardening-design.md`
- Checklist: `.codestable/features/2026-07-06-status-bar-polish-hardening/status-bar-polish-hardening-checklist.yaml`
- Design review: `.codestable/features/2026-07-06-status-bar-polish-hardening/status-bar-polish-hardening-design-review.md`
- Review: `.codestable/features/2026-07-06-status-bar-polish-hardening/status-bar-polish-hardening-review.md`
- QA: `.codestable/features/2026-07-06-status-bar-polish-hardening/status-bar-polish-hardening-qa.md`
- Acceptance: `.codestable/features/2026-07-06-status-bar-polish-hardening/status-bar-polish-hardening-acceptance.md`

## Core Runtime Path

Final hardening verifies the implemented status bar across state, route, viewport, safe-area, keyboard, panel, navigation, a11y, i18n, scope guards, and docs backfill. It does not add core product capability.

## Mandatory Commands

- `test -d packages/app/src/status-summary && test -f packages/app/src/status-summary/global-status-bar.test.tsx && test -f packages/app/src/status-summary/status-bar-session-navigation.test.ts && test -f packages/app/src/status-summary/status-bar-running-sessions.test.tsx`
- `npx vitest run packages/app/src/status-summary/global-status-bar.test.tsx --bail=1`
- `npx vitest run packages/app/src/status-summary/status-bar-session-navigation.test.ts --bail=1`
- `npx vitest run packages/app/src/status-summary/status-bar-running-sessions.test.tsx --bail=1`
- `npx vitest run packages/app/src/i18n/resources.test.ts --bail=1`
- `npm run test:e2e --workspace=@getpaseo/app -- status-bar` only when a targeted status-bar Playwright spec is added.
- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `rg "provider\\.usage\\.list|listProviderUsage|fetchAgents|timeline|archiveAgent|cancelAgent|restart|closeAgent|router\\.|buildHostAgentDetailRoute|buildHostWorkspaceRoute|useUnistyles|console\\.|TODO|FIXME" packages/app/src/status-summary packages/app/e2e/status-bar*.spec.ts packages/app/maestro/status-bar*`
- `rg "HostStatusBar|GlobalStatusBar|status\\.summary|HostStatusSummaryPayload" packages/app/src/app/_layout.tsx packages/protocol packages/client packages/server`

## Feature DoD

- S0 upstream landing gate passes before hardening starts.
- State matrix, layout matrix, interaction matrix, a11y/i18n/copy, scope guards, and docs backfill decision are complete.
- v1 keyboard policy is verified: footer remains visible while composer avoids extra footer-height offset.
- New copy keys cover en/ar/es/fr/ja/pt-BR/ru/zh-CN.
- Scope guard is manually classified and no core contract/lifecycle/provider/root-layout creep remains.

## Stage Gates And Recovery

- implementation.before_review: run scope-gate, dod-runner, evidence-pack.
- Review blocking returns to implementation review-fix.
- QA failed/blocked returns to implementation qa-fix, then rerun review and QA.
- Acceptance updates checklist checks and roadmap item.
- If S0 fails, stop and repair predecessor feature rather than continuing hardening.

## Evidence Required

- Command outputs.
- Filled evidence matrix or equivalent QA table.
- Desktop/compact screenshot or manual evidence for safe area, keyboard, panel, and navigation.
- i18n parity evidence.
- Docs/compound backfill diff or explicit no-backfill note.
- Scope grep and cleanliness evidence.
