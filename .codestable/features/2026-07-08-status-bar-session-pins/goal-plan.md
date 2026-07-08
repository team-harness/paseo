# status-bar-session-pins goal plan

Feature: `2026-07-08-status-bar-session-pins`

Design: `.codestable/features/2026-07-08-status-bar-session-pins/status-bar-session-pins-design.md`
Checklist: `.codestable/features/2026-07-08-status-bar-session-pins/status-bar-session-pins-checklist.yaml`
Design review: `.codestable/features/2026-07-08-status-bar-session-pins/status-bar-session-pins-design-review.md`

User confirmation: 2026-07-08, user said "确认，执行吧".

Baseline ref: `99ef8cee619ef56ecb72726123cd9198480f5ed6`

## Implementation Policy

- Follow checklist steps S1-S6 in order.
- Code behavior steps default to TDD micro-loop: RED -> GREEN -> VERIFY. If not practical, record `TDD exception` and substitute evidence.
- Do not use app-local AsyncStorage/session pin fallback.
- Do not add direct router/build-route calls or agent lifecycle mutations.

## Required Validation

- `npx vitest run packages/protocol/tests/messages.test.ts --bail=1` or the relevant protocol message test file.
- `npx vitest run packages/server/src/server/status-summary/session-pin-store.test.ts --bail=1`
- `npx vitest run packages/server/src/server/session.test.ts --bail=1`
- `npx vitest run packages/client/src/daemon-client.test.ts --bail=1`
- `npx vitest run packages/app/src/status-summary/status-bar-running-sessions.test.tsx --bail=1`
- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- Scope grep commands from checklist CMD-009 through CMD-011.

## Handoff Conditions

- Approved design must change.
- Public protocol contract must change beyond additive summary field and dotted set RPC.
- Same failure recurs three times.
- Required environment or credentials are missing.
