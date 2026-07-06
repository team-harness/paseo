# status-bar-running-sessions-nav Goal Feature Spec

- Roadmap item: `status-bar-running-sessions-nav`
- Depends on: `global-status-bar-shell`
- Feature type: functional
- Design: `.codestable/features/2026-07-06-status-bar-running-sessions-nav/status-bar-running-sessions-nav-design.md`
- Checklist: `.codestable/features/2026-07-06-status-bar-running-sessions-nav/status-bar-running-sessions-nav-checklist.yaml`
- Design review: `.codestable/features/2026-07-06-status-bar-running-sessions-nav/status-bar-running-sessions-nav-design-review.md`
- Review: `.codestable/features/2026-07-06-status-bar-running-sessions-nav/status-bar-running-sessions-nav-review.md`
- QA: `.codestable/features/2026-07-06-status-bar-running-sessions-nav/status-bar-running-sessions-nav-qa.md`
- Acceptance: `.codestable/features/2026-07-06-status-bar-running-sessions-nav/status-bar-running-sessions-nav-acceptance.md`

## Core Runtime Path

Status bar activity chip becomes a fixed trigger. Desktop opens DropdownMenu-based anchored panel; compact/native opens AdaptiveModalSheet. Session rows are grouped, deduped, formatted, and navigate through `navigateToAgent` / `navigateToWorkspace` helpers.

## Mandatory Commands

- `npx vitest run packages/app/src/status-summary/status-bar-session-navigation.test.ts --bail=1`
- `npx vitest run packages/app/src/status-summary/status-bar-running-sessions.test.tsx --bail=1`
- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `rg "router\\.|buildHostAgentDetailRoute|buildHostWorkspaceRoute|provider\\.usage\\.list|listProviderUsage|fetchAgents|archiveAgent|cancelAgent|restart|useUnistyles" packages/app/src/status-summary`

## Feature DoD

- Trigger is an in-place upgrade of shell activity chip, not a new parallel area.
- Desktop panel reuses DropdownMenu Modal/position/dismiss behavior; compact uses AdaptiveModalSheet.
- List order is attention > running > recent with dedup.
- Agent navigation uses `navigateToAgent`; workspace action is only shown for live/known workspace and uses `navigateToWorkspace`.
- Panel/sheet closes on route/server/view changes and before navigation.
- No lifecycle mutation/provider usage/protocol/server changes are added.

## Stage Gates And Recovery

- implementation.before_review: run scope-gate, dod-runner, evidence-pack.
- Review blocking returns to implementation review-fix.
- QA failed/blocked returns to implementation qa-fix, then rerun review and QA.
- Acceptance updates checklist checks and roadmap item.

## Evidence Required

- Command outputs.
- Desktop panel and compact sheet manual/screenshot evidence.
- Navigation helper call evidence.
- Scope grep and cleanliness evidence.
