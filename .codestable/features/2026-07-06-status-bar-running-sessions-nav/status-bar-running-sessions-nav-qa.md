---
doc_type: feature-qa
feature: 2026-07-06-status-bar-running-sessions-nav
status: passed
tested: 2026-07-06
round: 2
---

# status-bar-running-sessions-nav QA 报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-06-status-bar-running-sessions-nav/status-bar-running-sessions-nav-design.md`
- Checklist: `.codestable/features/2026-07-06-status-bar-running-sessions-nav/status-bar-running-sessions-nav-checklist.yaml`
- Review: `.codestable/features/2026-07-06-status-bar-running-sessions-nav/status-bar-running-sessions-nav-review.md`
- Evidence pack: `.codestable/features/2026-07-06-status-bar-running-sessions-nav/status-bar-running-sessions-nav-evidence-pack.md`
- Gate results: `.codestable/features/2026-07-06-status-bar-running-sessions-nav/status-bar-running-sessions-nav-scope-gate.json`
- DoD results: `.codestable/features/2026-07-06-status-bar-running-sessions-nav/status-bar-running-sessions-nav-dod-results.json`
- Diff basis: feature worktree dirty only for this feature files, generated CodeStable artifacts, and roadmap goal-state.
- Feature type: functional.
- Core evidence gate: desktop DropdownMenu anchored panel, compact AdaptiveModalSheet, navigation close lifecycle, grouping/dedup, workspace action gating, and scope guards.

## 2. Verification Matrix

| ID     | 来源                              | 核心性          | 场景 / 风险                                                                    | 证据类型   | 命令或动作                                                                                      | 期望                                         | 结果 |
| ------ | --------------------------------- | --------------- | ------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------- | ---- |
| QA-001 | design S1/C2/C3                   | core-functional | 分组、去重、缺失 workspace action                                              | unit       | `npx vitest run packages/app/src/status-summary/status-bar-session-navigation.test.ts --bail=1` | pass                                         | pass |
| QA-002 | design S2/S3/C6                   | core-functional | desktop/compact trigger、sheet/panel state、row press 先关闭再导航             | component  | `npx vitest run packages/app/src/status-summary/status-bar-running-sessions.test.tsx --bail=1`  | pass                                         | pass |
| QA-003 | design S2                         | core-functional | compact 下 snapshots 存在时不重复 running/attention chips                      | component  | `status-bar-running-sessions.test.tsx`                                                          | pass                                         | pass |
| QA-004 | design §3.2/C7                    | supporting      | 无直接 router/build route/provider usage/fetch/lifecycle mutation/useUnistyles | grep       | `! rg ... packages/app/src/status-summary`                                                      | no matches                                   | pass |
| QA-005 | repo quality                      | supporting      | 类型、lint、格式                                                               | command    | `npm run typecheck`, `npm run lint`, `npm run format:check`                                     | exit 0                                       | pass |
| QA-006 | review I1 / design S3/S4/C4/C5/C8 | core-functional | 真实 desktop anchored panel 和 compact sheet 平台行为                          | playwright | `npm run test:e2e --workspace=@getpaseo/app -- status-bar-running-sessions.spec.ts`             | desktop/compact 浮层真实打开、关闭、定位正确 | pass |

## 3. Command Results

- `npx vitest run packages/app/src/status-summary/status-bar-session-navigation.test.ts --bail=1` → exit 0：1 file / 3 tests passed。
- `npx vitest run packages/app/src/status-summary/status-bar-running-sessions.test.tsx --bail=1` → exit 0：1 file / 4 tests passed。
- `npx vitest run packages/app/src/status-summary/status-bar-session-navigation.test.ts packages/app/src/status-summary/status-bar-running-sessions.test.tsx packages/app/src/status-summary/global-status-bar.test.tsx --bail=1` → exit 0：3 files / 14 tests passed。
- `npm run test:e2e --workspace=@getpaseo/app -- status-bar-running-sessions.spec.ts` → exit 0：2 Playwright tests passed。
- `python3 .codestable/tools/codestable-dod-runner.py --checklist ... --json-out ... --stage implementation.after_qa_fix` → exit 0：CMD-001..CMD-007 passed。
- `python3 .codestable/tools/codestable-scope-gate.py ... --stage implementation.after_qa_fix` → exit 0：scope gate passed。
- `python3 .codestable/tools/codestable-evidence-pack.py ... --stage implementation.after_qa_fix` → exit 0：evidence pack passed。
- `/Users/wyattfang/.local/bin/python3.11 .codestable/tools/validate-yaml.py --file ... --yaml-only` → exit 0：checklist YAML valid。
- `npm run typecheck` → exit 0：workspace typecheck passed。
- `npm run lint` → exit 0：0 warnings / 0 errors。
- `npm run format:check` → exit 0：all matched files use correct format。

## 4. Scenario Results

- [x] QA-001 grouping/dedup/workspace action：pass。
  - Evidence: resolver unit test covers attention > running > recent, missing workspaceId, unknown workspace, helper calls.
- [x] QA-002 trigger/panel/sheet state flow：pass。
  - Evidence: component test covers desktop trigger/panel, compact sheet, row press close before agent navigation, workspace action live gating, route change close.
- [x] QA-003 compact in-place upgrade：pass。
  - Evidence: component test and Playwright e2e both assert compact with snapshots does not render original running/attention chips and renders one sessions trigger.
- [x] QA-004 scope guard：pass。
  - Evidence: DoD grep has no matches; scope gate passed with feature files, status-summary implementation/tests, e2e spec, and roadmap goal-state only.
- [x] QA-005 repo quality：pass。
  - Evidence: typecheck/lint/format passed after formatting generated JSON and e2e spec.
- [x] QA-006 真实平台浮层验证：pass。
  - Evidence: Playwright Desktop Chrome opens the real app on a host workspace route with isolated e2e daemon/Metro.
  - Desktop case validates panel rows, panel above trigger, footer height stable within 1px, Esc close, outside press close, and route-change close.
  - Compact case validates sheet open, backdrop close via visible top backdrop area, workspace action close, and workspace route remains valid.

## 5. Findings

### fixed during QA

- React 19 / `useSyncExternalStore` 下，`status-bar-running-sessions.tsx` 原 selector 返回 `new Set(...)` 会触发 `Maximum update depth exceeded`。已改为 selector 只读取 `workspaces`，再用 `useMemo` 派生 `Set`。
- e2e 首版用 backdrop locator 默认中心点击，中心可能落在 sheet 覆盖区域，导致偶发不关闭。已改为点击 backdrop 顶部空白区域，验证真实 backdrop dismiss 行为。

### failed

none。

### blocked

none。

### residual-risk

- 当前 Playwright 覆盖的是 web compact viewport，不是真机 native compact。native hardware back、真实 safe area、Android/iOS Gorhom bottom sheet 生命周期未在本 feature 中跑设备或 Maestro 证据；留给后续 `status-bar-polish-hardening` 的 compact/native hardening 验证。

## 6. Cleanliness

- Debug output: pass。
- Temporary TODO/FIXME/XXX: pass。
- Commented-out code: pass。
- Unused imports / dead code from this feature: pass。
- Out-of-scope files: pass。

## 7. Verdict

- Status: passed。
- Acceptance: 可进入 feature acceptance / commit；round 1 的 QA-006 blocked 已由 Playwright e2e 和 selector 修复关闭。剩余 native compact 设备覆盖是非 blocking test gap。
