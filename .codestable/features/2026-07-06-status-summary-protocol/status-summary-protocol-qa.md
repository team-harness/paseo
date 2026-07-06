---
doc_type: feature-qa
feature: 2026-07-06-status-summary-protocol
status: passed
tested: 2026-07-06
round: 1
---

# status-summary-protocol QA 报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-design.md`
- Checklist: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-checklist.yaml`
- Review: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-review.md`
- Evidence pack: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-evidence-pack.md`
- Gate results: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-scope-gate.json`
- DoD results: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-dod-results.json`
- Feature type: protocol / server / client SDK

## 2. Verification Matrix

| ID     | 来源           | 场景 / 风险                             | 命令或动作                                                                                         | 结果 |
| ------ | -------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- | ---- |
| QA-001 | protocol       | get/response/updated schema + gate      | `npx vitest run packages/protocol/src/messages.test.ts --bail=1 -t status-summary`                 | pass |
| QA-002 | service        | totals、parentAgentId、counts、fallback | `npx vitest run packages/server/src/server/status-summary/status-summary-service.test.ts --bail=1` | pass |
| QA-003 | server session | get RPC 与 coalesced push               | `npx vitest run packages/server/src/server/session.test.ts --bail=1 -t status-summary`             | pass |
| QA-004 | client driver  | DaemonClient correlated RPC             | `npx vitest run packages/client/src/daemon-client.test.ts --bail=1 -t status-summary`              | pass |
| QA-005 | SDK facade     | `status.summary/subscribe`              | `npx vitest run packages/client/src/index.test.ts --bail=1 -t status-actions`                      | pass |
| QA-006 | repo command   | 类型、lint、格式                        | `npm run typecheck`; `npm run lint`; `npm run format:check`                                        | pass |
| QA-007 | gates          | scope/DoD/evidence pack                 | `codestable-scope-gate.py`; `codestable-dod-runner.py`; `codestable-evidence-pack.py`              | pass |

## 3. Command Results

- `npx vitest run packages/protocol/src/messages.test.ts --bail=1 -t status-summary` -> exit 0: 4 tests passed.
- `npx vitest run packages/server/src/server/status-summary/status-summary-service.test.ts --bail=1` -> exit 0: 3 tests passed.
- `npx vitest run packages/server/src/server/session.test.ts --bail=1 -t status-summary` -> exit 0: 2 tests passed.
- `npx vitest run packages/client/src/daemon-client.test.ts --bail=1 -t status-summary` -> exit 0: 1 test passed.
- `npx vitest run packages/client/src/index.test.ts --bail=1 -t status-actions` -> exit 0: 1 test passed.
- `npm run typecheck` -> exit 0.
- `npm run lint` -> exit 0.
- `npm run format:check` -> exit 0.
- `python3 .codestable/tools/codestable-scope-gate.py ...` -> exit 0.
- `python3 .codestable/tools/codestable-dod-runner.py ...` -> exit 0.
- `python3 .codestable/tools/codestable-evidence-pack.py ...` -> exit 0.

## 4. Scenario Results

- [x] Protocol request/response/push parse: pass.
- [x] Response correlation shape: pass.
- [x] Summary service totals and `totalTokens`: pass.
- [x] Activity snapshots and counts: pass.
- [x] Ledger read failure fallback: pass.
- [x] Session get RPC and coalesced push: pass.
- [x] WebSocket feature gate with `COMPAT(statusSummary)`: pass.
- [x] Client SDK low-level and high-level facade: pass.
- [x] Repo validation: pass.

## 5. Findings

### failed

- none

### blocked

- none

### residual-risk

- Real multi-client fan-out was verified by service/session shape and subscription tests, not by an end-to-end daemon with multiple WebSocket clients.
- `activity.counts.error` has no matching v1 error agents list. This is accepted design scope.
- `byProvider` / `byModel` are present as empty arrays in v1.
- Daemon local-day today window is tested with injected clock; system timezone changes while daemon is running are not tested.

## 6. Cleanliness

- Debug output: pass.
- Temporary TODO/FIXME/XXX: pass for this feature's implementation paths; an existing TODO in `packages/client/src/index.ts` predates this feature and is unrelated.
- Commented-out code: pass.
- Unused imports / dead code from this feature: pass.
- Out-of-scope files: pass for scope gate.

## 7. Verdict

- Status: passed
- Next: `cs-feat` acceptance 阶段。
