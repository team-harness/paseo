---
doc_type: feature-qa
feature: 2026-07-06-app-status-summary-store
status: passed
tested: 2026-07-06
round: 1
---

# app-status-summary-store QA 报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-design.md`
- Checklist: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-checklist.yaml`
- Review: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-review.md`
- Evidence pack: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-evidence-pack.md`
- Gate results: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-scope-gate.json`
- DoD results: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-dod-results.json`
- Feature type: app store / React Query cache / view model

## 2. Verification Matrix

| ID     | 来源            | 场景 / 风险                               | 命令或动作                                                                                                   | 结果 |
| ------ | --------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---- |
| QA-001 | view model      | rows、agent lists、empty totals、fallback | `npx vitest run packages/app/src/status-summary/view-model.test.ts --bail=1`                                 | pass |
| QA-002 | push            | full snapshot replace、serverId 隔离      | `npx vitest run packages/app/src/status-summary/push.test.ts --bail=1`                                       | pass |
| QA-003 | query helpers   | enable gate、explicit refresh、error/data | `npx vitest run packages/app/src/status-summary/use-status-summary.test.ts --bail=1`                         | pass |
| QA-004 | SessionProvider | refresh/push helper 接线                  | `npx vitest run packages/app/src/contexts/session-context.service-status.test.ts --bail=1 -t status-summary` | pass |
| QA-005 | repo command    | 类型、lint、格式                          | `npm run typecheck`; `npm run lint`; `npm run format:check`                                                  | pass |
| QA-006 | gates           | scope/DoD/evidence pack                   | `codestable-scope-gate.py`; `codestable-dod-runner.py`; `codestable-evidence-pack.py`                        | pass |

## 3. Command Results

- `npx vitest run packages/app/src/status-summary/view-model.test.ts --bail=1` -> exit 0: 4 tests passed.
- `npx vitest run packages/app/src/status-summary/push.test.ts --bail=1` -> exit 0: 2 tests passed.
- `npx vitest run packages/app/src/status-summary/use-status-summary.test.ts --bail=1` -> exit 0: 8 tests passed.
- `npx vitest run packages/app/src/contexts/session-context.service-status.test.ts --bail=1 -t status-summary` -> exit 0: 1 test passed, 3 skipped by filter.
- `npm run typecheck` -> exit 0.
- `npm run lint` -> exit 0.
- `npm run format:check` -> exit 0.
- `python3 .codestable/tools/codestable-scope-gate.py ...` -> exit 0.
- `python3 .codestable/tools/codestable-dod-runner.py ...` -> exit 0.
- `python3 .codestable/tools/codestable-evidence-pack.py ...` -> exit 0.

## 4. Scenario Results

- [x] query key 按 `serverId` 隔离。
- [x] fetch enable 只在 serverId、client、online、`features.statusSummary` 全满足时为 true。
- [x] unsupported host 不调用 client，view model 可表达 unsupported。
- [x] explicit refresh 在 `staleTime: Infinity` 下仍 refetch。
- [x] push 用完整 snapshot replace cache，不 patch merge。
- [x] get 失败后 push data 优先，不被旧 error 遮住。
- [x] offline/unsupported/loading/error 可保留 previous summary。
- [x] SessionProvider 接入 refresh 和 push，cleanup 路径包含 status summary unsubscribe。
- [x] 未实现 UI/shell/navigation，未调用 provider usage API，未拼旧 daemon fallback。

## 5. Findings

### failed

- none

### blocked

- none

### residual-risk

- 真实移动 app resume 与多 host client 并发行为未做设备级手工 QA；本 feature 是 store/view model，不包含 UI。
- 后续 shell feature 必须避免把 offline previous summary 渲染成 live 状态。
- `mise trust` warning 在本 worktree 持续出现，但命令均执行成功；未影响验证结果。

## 6. Cleanliness

- Debug output: pass.
- Temporary TODO/FIXME/XXX: pass for this feature's implementation paths.
- Commented-out code: pass.
- Unused imports / dead code from this feature: pass.
- Out-of-scope files: pass for scope gate.

## 7. Verdict

- Status: passed
- Next: acceptance。
