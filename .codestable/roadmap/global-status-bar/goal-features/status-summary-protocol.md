# status-summary-protocol Goal Feature Spec

- Roadmap item: `status-summary-protocol`
- Depends on: `usage-history-persistence`
- Feature type: functional
- Design: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-design.md`
- Checklist: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-checklist.yaml`
- Design review: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-design-review.md`
- Review: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-review.md`
- QA: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-qa.md`
- Acceptance: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-acceptance.md`

## Core Runtime Path

Daemon exposes `status.summary.get.request/response` and `status.summary.updated` behind `server_info.features.statusSummary`. `StatusSummaryService` aggregates usage ledger totals and agent snapshots, while client SDK can fetch and subscribe to typed summary messages.

## Mandatory Commands

- `npx vitest run packages/protocol/src/messages.test.ts --bail=1 -t "status summary"`
- `npx vitest run packages/server/src/server/status-summary/status-summary-service.test.ts --bail=1`
- `npx vitest run packages/server/src/server/session.test.ts --bail=1 -t "status summary"`
- `npx vitest run packages/client/src/daemon-client.test.ts --bail=1 -t "status summary"`
- `npm run typecheck`
- `npm run lint`
- `npm run format:check`

## Feature DoD

- Protocol schemas, feature gate, server session handling, service singleton wiring, push coalescing, and client SDK method are implemented.
- Response shape follows client correlated response contract with `payload.{requestId, summary}`.
- No provider plan usage, app store, UI, old daemon fallback, or ledger merge changes are added.

## Stage Gates And Recovery

- implementation.before_review: run scope-gate, dod-runner, evidence-pack.
- Review blocking returns to implementation review-fix.
- QA failed/blocked returns to implementation qa-fix, then rerun review and QA.
- Acceptance updates checklist checks and roadmap item.

## Evidence Required

- Command outputs.
- Protocol parse compatibility evidence.
- Service coalescing evidence.
- Diff summary and cleanliness evidence.
