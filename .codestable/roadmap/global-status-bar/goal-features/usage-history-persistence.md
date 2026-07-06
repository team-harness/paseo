# usage-history-persistence Goal Feature Spec

- Roadmap item: `usage-history-persistence`
- Depends on: none
- Feature type: functional
- Design: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-design.md`
- Checklist: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-checklist.yaml`
- Design review: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-design-review.md`
- Review: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-review.md`
- QA: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-qa.md`
- Acceptance: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-acceptance.md`

## Core Runtime Path

Provider-like usage events enter AgentManager, are bridged into `UsageLedger`, persisted under `$PASEO_HOME`, and queried for lifetime/today totals across duplicate events, turn boundaries, daemon restart, day windows, and archived agents.

## Mandatory Commands

- `npx vitest run packages/server/src/server/usage-ledger/usage-ledger.test.ts --bail=1`
- `npx vitest run packages/server/src/server/agent/agent-manager.test.ts --bail=1 -t "usage ledger"`
- `npm run typecheck`
- `npm run lint`
- `npm run format:check`

## Feature DoD

- Usage ledger deep module exists and owns merge/dedup/persistence semantics.
- AgentManager only performs lightweight non-blocking bridge calls.
- Tests cover per-provider fixture semantics, duplicate event dedup, negative/reset/stale handling, restart, today window, and archived agents.
- No status summary protocol, app UI, provider quota fetch, or lifecycle semantics are introduced here.

## Stage Gates And Recovery

- implementation.before_review: run scope-gate, dod-runner, evidence-pack.
- Review blocking returns to implementation review-fix.
- QA failed/blocked returns to implementation qa-fix, then rerun review and QA.
- Acceptance updates checklist checks and roadmap item.

## Evidence Required

- Command outputs.
- Diff summary.
- Persistence path/schema evidence.
- Provider fixture coverage evidence.
- Cleanliness: no debug output, temporary TODO, or commented code.
