# app-status-summary-store Goal Feature Spec

- Roadmap item: `app-status-summary-store`
- Depends on: `status-summary-protocol`
- Feature type: functional
- Design: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-design.md`
- Checklist: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-checklist.yaml`
- Design review: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-design-review.md`
- Review: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-review.md`
- QA: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-qa.md`
- Acceptance: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-acceptance.md`

## Core Runtime Path

App maintains host-scoped status summary cache via React Query, applies `status.summary.updated` push, runs command-style refresh on initial connect/reconnect/resume, and exposes `useHostStatusSummary(serverId)` / `useGlobalStatusBarView(serverId)`.

## Mandatory Commands

- `npx vitest run packages/app/src/status-summary/view-model.test.ts --bail=1`
- `npx vitest run packages/app/src/status-summary/push.test.ts --bail=1`
- `npx vitest run packages/app/src/status-summary/use-status-summary.test.ts --bail=1`
- `npx vitest run packages/app/src/contexts/session-context.service-status.test.ts --bail=1 -t "status summary"`
- `npm run typecheck`
- `npm run lint`
- `npm run format:check`

## Feature DoD

- Query/cache/push/view-model/hook modules live under `packages/app/src/status-summary/`.
- Capability gate is centralized and unsupported/offline/loading/error/ready states are cleanly represented.
- Reconnect/resume refresh uses `fetchQuery`/`prefetchQuery`, not observer-dependent invalidation only.
- No UI shell, navigation, provider usage fetch, old RPC fallback, AsyncStorage persistence, or protocol changes are added.

## Stage Gates And Recovery

- implementation.before_review: run scope-gate, dod-runner, evidence-pack.
- Review blocking returns to implementation review-fix.
- QA failed/blocked returns to implementation qa-fix, then rerun review and QA.
- Acceptance updates checklist checks and roadmap item.

## Evidence Required

- Command outputs.
- Hook/query evidence.
- Push cache replacement evidence.
- Scope grep/diff evidence and cleanliness evidence.
