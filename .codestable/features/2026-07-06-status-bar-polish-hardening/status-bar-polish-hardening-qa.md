---
doc_type: feature-qa
feature: 2026-07-06-status-bar-polish-hardening
status: passed
tested: 2026-07-06
round: 1
---

# status-bar-polish-hardening QA 报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-06-status-bar-polish-hardening/status-bar-polish-hardening-design.md`
- Checklist: `.codestable/features/2026-07-06-status-bar-polish-hardening/status-bar-polish-hardening-checklist.yaml`
- Evidence pack: `.codestable/features/2026-07-06-status-bar-polish-hardening/status-bar-polish-hardening-evidence-pack.md`
- Gate results: `.codestable/features/2026-07-06-status-bar-polish-hardening/status-bar-polish-hardening-scope-gate.json`
- DoD results: `.codestable/features/2026-07-06-status-bar-polish-hardening/status-bar-polish-hardening-dod-results.json`
- Feature type: polish / hardening。

## 2. Verification Matrix

| ID     | 来源         | 场景 / 风险                                                                                     | 证据                                                        | 结果 |
| ------ | ------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---- |
| QA-001 | S0 / C0      | 前置 store/shell/nav 已合并，目标测试文件存在                                                   | `CMD-001`                                                   | pass |
| QA-002 | S1 / S2 / C2 | ready/loading/offline/error/unsupported/empty 状态和 display rows 不回退伪造数据                | `global-status-bar.test.tsx`, `view-model.test.ts`          | pass |
| QA-003 | S4 / C4      | desktop panel Esc/outside/route-change，compact sheet backdrop/workspace press close-before-nav | `status-bar-running-sessions.test.tsx`, targeted Playwright | pass |
| QA-004 | S5 / C5      | 状态栏 copy 迁入八语言 i18n resources，runtime 值不翻译                                         | `resources.test.ts`, diff review                            | pass |
| QA-005 | C6 / C9      | 无 protocol/server/provider usage/lifecycle mutation/root layout 越界                           | scope grep, scope gate                                      | pass |
| QA-006 | C7           | 只运行目标 Vitest 和具体 Playwright spec，没有全量 suite                                        | command log                                                 | pass |

## 3. Command Results

- `npx vitest run packages/app/src/status-summary/global-status-bar.test.tsx packages/app/src/status-summary/status-bar-session-navigation.test.ts packages/app/src/status-summary/status-bar-running-sessions.test.tsx packages/app/src/status-summary/view-model.test.ts packages/app/src/i18n/resources.test.ts --bail=1` -> exit 0：5 files / 52 tests passed。
- `npm run test:e2e --workspace=@getpaseo/app -- status-bar-running-sessions.spec.ts` -> exit 0：2 Playwright tests passed。
- `npm run typecheck` -> exit 0：workspace typecheck passed。
- `npm run lint` -> exit 0：0 warnings / 0 errors。
- `npm run format:check` -> exit 0：all matched files use correct format。
- `/Users/wyattfang/.local/bin/python3.11 .codestable/tools/validate-yaml.py --file ... --yaml-only` -> exit 0。
- `.codestable/tools/codestable-scope-gate.py ...` -> status passed / no warnings。
- `.codestable/tools/codestable-dod-runner.py ...` -> status passed。

## 4. Findings

### fixed during QA

- Targeted Playwright 首轮发现 compact web sheet 点击 workspace action 后仍可见。初版修复曾条件卸载 sheet，但独立 review 指出这会绕过 Gorhom dismiss lifecycle。最终改为保留 `AdaptiveModalSheet` 挂载，compact 导航在 `setOpen(false)` 后延后一帧执行，让 `visible=false` 先进入 sheet lifecycle；组件测试新增 agent/workspace close-before-nav 顺序断言，Playwright 复跑通过。
- Checklist 原 `CMD-006` 使用 `status-bar` 过宽，会匹配 222 个 app E2E；已改为具体 `status-bar-running-sessions.spec.ts`。
- Checklist 原 `CMD-010` 带不存在的 Maestro glob，zsh/rg 会把缺失 glob 当失败；已收敛为生产 `status-summary` 目录的无命中 scope guard。E2E spec 中 route-builder helper 命中属于测试夹具导航，不是生产越界。

### failed

none。

### blocked

none。

### residual-risk

- 当前自动化覆盖 desktop Chrome 和 compact web viewport，不覆盖真实 iOS/Android hardware back、home indicator safe area、Android/iOS Gorhom bottom sheet 生命周期。该风险已在 checklist C3 标记为 `passed-with-gap`，需要后续设备/Maestro 或手工证据补齐。
- `CMD-011` 会命中前置 `status.summary.*` protocol/client/server 实现；本 feature 未修改这些文件，QA 分类为合法前置实现命中。

## 5. Cleanliness

- Product debug output: pass。
- 注释掉代码 / 临时 QA 文件 / 截图产物：pass。
- Product code scope guard：pass。
- `packages/app/test-results` 已清理。

## 6. Verdict

Status: passed。

本 feature 完成状态栏 i18n/copy 收口，并通过 hardening 验证发现并修复 compact sheet workspace navigation 残留问题。剩余 native compact 设备覆盖是非 blocking test gap。
