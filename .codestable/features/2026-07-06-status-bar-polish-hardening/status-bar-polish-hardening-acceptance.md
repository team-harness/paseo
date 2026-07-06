---
doc_type: feature-acceptance
feature: 2026-07-06-status-bar-polish-hardening
status: passed
accepted: 2026-07-06
round: 1
---

# status-bar-polish-hardening 验收报告

## 1. 接口契约核对

- [x] 本 feature 未改 `status.summary.*` protocol、client SDK RPC、server service 或 usage ledger。
- [x] `GlobalStatusBar` 与 `StatusBarRunningSessionsTrigger` 只做 UI polish、i18n copy 和 compact sheet lifecycle hardening。
- [x] Client-owned 状态栏 copy 已迁入 `packages/app/src/i18n/resources/*`。
- [x] runtime values 保持运行时值：token 数、费用、agent title、provider、cwd/path 不翻译。

## 2. 行为核对

- [x] ready/loading/offline/error/unsupported 状态通过目标测试覆盖。
- [x] compact 下有 snapshots 时仍只展示 sessions trigger，不重复展示 running/attention chips。
- [x] desktop panel 通过真实 Playwright 验证 Esc、outside press、route change 关闭。
- [x] compact web sheet 通过真实 Playwright 验证 backdrop 关闭、workspace action close-before-nav。
- [x] QA 中发现的 compact sheet workspace action 残留已修复，并由组件测试与 Playwright 共同覆盖。

## 3. 验证命令

- [x] `npx vitest run packages/app/src/status-summary/global-status-bar.test.tsx packages/app/src/status-summary/status-bar-session-navigation.test.ts packages/app/src/status-summary/status-bar-running-sessions.test.tsx packages/app/src/status-summary/view-model.test.ts packages/app/src/i18n/resources.test.ts --bail=1`
- [x] `npm run test:e2e --workspace=@getpaseo/app -- status-bar-running-sessions.spec.ts`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run format:check`
- [x] CodeStable checklist YAML validation / DoD runner / scope gate / evidence pack。

## 4. Scope 分类

- `CMD-010` 生产 scope guard 无命中：未新增 provider usage fetch、旧 RPC fallback、agent lifecycle mutation、direct router push、root layout status bar、`useUnistyles` 或 debug marker。
- `CMD-011` 命中前置 protocol/client/server `status.summary.*` 代码，分类为已合并前置 feature 的合法实现；hardening diff 未触碰这些文件。
- E2E spec 中 `buildHostAgentDetailRoute` / `buildHostWorkspaceRoute` 是测试夹具导航 helper，不是生产 status-summary 越界。

## 5. 文档与长期规则

- `docs/i18n.md` 已有 client-owned UI copy / runtime values 边界，当前实现遵守，无需新增长期文档。
- `docs/testing.md` 已有 targeted Playwright 规则；本轮修正 checklist，避免宽泛 `status-bar` pattern 触发全量 E2E。
- Native compact safe-area/hardware-back 仍是 test gap，记录在 QA residual risk，不写成稳定产品规则。

## 6. 遗留

- 非 blocking：真实 iOS/Android hardware back、home indicator safe area、Gorhom native bottom sheet 生命周期未在本 feature 自动化覆盖。

## 7. Verdict

passed。可进入 independent review 和 roadmap 回写。
