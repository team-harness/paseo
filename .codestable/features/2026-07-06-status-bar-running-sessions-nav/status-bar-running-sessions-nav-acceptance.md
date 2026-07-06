---
doc_type: feature-acceptance
feature: 2026-07-06-status-bar-running-sessions-nav
status: passed
accepted: 2026-07-06
round: 1
---

# status-bar-running-sessions-nav 验收报告

> 阶段：阶段 3（验收闭环）  
> 验收日期：2026-07-06  
> 关联方案 doc：`.codestable/features/2026-07-06-status-bar-running-sessions-nav/status-bar-running-sessions-nav-design.md`

## 1. 接口契约核对

- [x] `GlobalStatusBar` 从 host layout 接收 `serverId`，ready 状态下把 activity snapshots 传给 `StatusBarRunningSessionsTrigger`。
- [x] `StatusBarRunningSessionsTrigger` 对 running / needs attention / recently completed snapshots 构建统一列表。
- [x] `buildStatusBarSessionList` 按 attention > running > recent 分组，并按 `agentId` 去重。
- [x] `navigateToStatusBarSession` 只调用 `navigateToAgent` / `navigateToWorkspace`，未直接拼 Expo Router route。
- [x] workspace secondary action 仅当 `workspaceId` 存在且在 live workspace set 中时显示。

## 2. 行为与决策核对

- [x] trigger 是对原 running/attention activity chips 的 in-place 升级；有 snapshots 时不重复展示原 chips。
- [x] desktop/web 使用 `DropdownMenuContent` 承载锚定 panel，复用其定位、backdrop、Esc/outside press 关闭能力。
- [x] compact 使用 `AdaptiveModalSheet` 承载同一列表，不手搓 overflowing popover。
- [x] row primary action 先关闭 panel/sheet 再导航到 agent。
- [x] workspace action 先关闭 panel/sheet 再导航到 workspace。
- [x] route/server 变化、items 变空时关闭 panel/sheet。
- [x] 本 feature 不新增 protocol/server/provider usage fetch/agent lifecycle mutation。

## 3. 验收场景核对

- [x] grouping/dedup/workspace gating：`status-bar-session-navigation.test.ts` 覆盖。
- [x] desktop/compact trigger 和 close lifecycle：`status-bar-running-sessions.test.tsx` 覆盖。
- [x] global bar ready/compact rows 互斥：`global-status-bar.test.tsx` 覆盖。
- [x] 真实 desktop panel：Playwright 验证 panel rows、panel 在 trigger 上方、footer 高度稳定、Esc/outside press/route change 关闭。
- [x] compact web sheet：Playwright 验证 390x844 viewport 下 sheet 打开、backdrop 关闭、workspace action 关闭、原 running/attention chips 不重复。
- [x] React 19 selector bug：QA 中发现 `new Set(...)` selector 造成 `Maximum update depth exceeded`，已改为 selector 取 `workspaces` + `useMemo` 派生。
- [x] QA 报告 passed，failed/blocked 为 none。
- [x] Evidence pack、DoD Results、Gate Results 已复核，blocking 为 none。

## 4. 术语一致性

- `Running session snapshot`、`Status bar detail panel`、`Desktop anchored panel`、`Compact sheet` 与 design 术语一致。
- UI 文案使用 `Agent sessions` / `Sessions`，与“action surface 不是完整 sessions/history 页面”的设计边界一致。

## 5. 领域影响盘点

- 本 feature 仅消费既有 status summary view model 和 `StatusAgentSnapshot`，未改变协议或领域模型。
- `StatusBarRunningSessionsTrigger` 是状态栏 UI 内部组件，不需要新增 ADR。
- 后续 native compact 设备覆盖属于 `status-bar-polish-hardening` 的 hardening 范畴。

## 6. requirement delta / clarification 回写

无 requirement 影响。本 feature 是 roadmap 子项实现，没有独立 owner-approved requirement delta 需要应用。

## 7. roadmap 回写

- [x] `.codestable/roadmap/global-status-bar/global-status-bar-items.yaml` 中 `status-bar-running-sessions-nav` 回写为 `done`，feature 为 `2026-07-06-status-bar-running-sessions-nav`。
- [x] `.codestable/roadmap/global-status-bar/global-status-bar-roadmap.md` 第 5 节对应条目同步为 `done`。
- [x] `.codestable/roadmap/global-status-bar/goal-state.yaml` 中 feature 5 标记 `accepted`，`current_feature_index: 5`。

## 8. attention.md 候选盘点

- 候选：真实 e2e 中 `StatusAgentSnapshot.status` 必须使用协议合法值；attention snapshot 应使用 `status: "closed"` + `stateBucket: "needs_input"`，不能写非 schema 值。该细节属于本 e2e fixture 的局部经验，暂不写入 `.codestable/attention.md`。
- 候选：Zustand selector 不应返回每次新建的 `Set` / `Map` / object；本次已用 `useMemo` 修复。该模式在 React 19 下风险较高，后续若再次出现可沉淀到项目 docs 或 attention。

## 9. 遗留

- 非 blocking test gap：当前 Playwright 覆盖 compact web viewport，不覆盖真机 native hardware back、真实 safe area、Android/iOS Gorhom bottom sheet 生命周期；由 `status-bar-polish-hardening` 承接。
- 后续 polish：hitSlop 可从数字改成显式对象，属于可读性 nit。

## 10. 最终审计

- Re-verified:
  - `npx vitest run packages/app/src/status-summary/status-bar-session-navigation.test.ts packages/app/src/status-summary/status-bar-running-sessions.test.tsx packages/app/src/status-summary/global-status-bar.test.tsx --bail=1`
  - `npm run test:e2e --workspace=@getpaseo/app -- status-bar-running-sessions.spec.ts`
  - `python3 .codestable/tools/codestable-dod-runner.py --checklist ... --json-out ... --stage implementation.after_qa_fix`
  - `python3 .codestable/tools/codestable-scope-gate.py ... --stage implementation.after_qa_fix`
  - `python3 .codestable/tools/codestable-evidence-pack.py ... --stage implementation.after_qa_fix`
  - `/Users/wyattfang/.local/bin/python3.11 .codestable/tools/validate-yaml.py --file ... --yaml-only`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run format:check`
- Trust-prior-verify:
  - 独立 Paseo reviewer round 2 `8806c66a-cd3f-4d31-86a9-cc5cac7920ac` 输出无 blocking；P2 文档表述问题已合并为 residual test gap。
- 交付物落盘：
  - implementation files、e2e、review、QA、acceptance、scope gate、DoD results、evidence pack 均存在。
- Diff 清洁度：
  - 当前 dirty diff 仅包含本 feature 范围和 roadmap/status 回写。
- Verdict: passed。
