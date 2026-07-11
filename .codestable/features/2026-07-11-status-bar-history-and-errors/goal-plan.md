---
doc_type: feature-goal-plan
feature: 2026-07-11-status-bar-history-and-errors
status: ready
---

# Status bar 历史与会话状态 UI goal plan

## 已确认输入

- Design: `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-design.md`
- Checklist: `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-checklist.yaml`
- Design review: `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-design-review.md`
- 用户于 2026-07-11 确认 design，并明确：不增强 errors，不改 daemon/protocol；空闲与活跃状态使用统一会话状态 UI。

## 执行范围

- 在已加载 history 集合内，先过滤 lifecycle `closed` 和带有效 parent-agent label 的 agent，再截断十条。
- ready status bar 始终显示会话状态区域，移除空闲时独立 running/attention primary chips。
- 无会话时以静态 View 呈现 `TriggerContent`，建议 `testID="status-bar-sessions-static"`；不得挂载 open state、route effect、Pressable、DropdownMenu 或 sheet。
- 有会话时保持既有 trigger、desktop/compact overlay、固定和导航行为。
- 生产代码范围预计只包括 `packages/app/src/status-summary/global-status-bar.tsx` 与 `packages/app/src/status-summary/status-bar-running-sessions.tsx`；同步更新对应两个测试文件。

## 禁止范围

- 不改 errors 能力、server、protocol、client SDK、feature flags、RPC、agent lifecycle 或 archive。
- 不新增 fetch、分页、history persistence、错误专用 surface 或 direct router 调用。

## TDD 与核心验收路径

- 每个行为 step 默认 RED -> GREEN -> VERIFY：先在目标测试中写出 history 过滤或空闲静态视图行为，再实现最小代码，再运行对应目标测试。
- 例外：若现有测试基础设施无法精确观察 state/effect 是否未挂载，记录 `TDD exception`，以静态 component boundary、无 button role/panel 断言和 diff review 作为替代证据。
- 核心路径：history 的 closed/subagent 过滤；空闲静态视图；活跃 panel 与 navigation 回归。

## 必跑验证

1. `mise exec nodejs@22.20.0 -- npx vitest run packages/app/src/status-summary/status-bar-running-sessions.test.tsx packages/app/src/status-summary/global-status-bar.test.tsx --bail=1`
2. `mise exec nodejs@22.20.0 -- npm run format:files -- packages/app/src/status-summary/global-status-bar.tsx packages/app/src/status-summary/status-bar-running-sessions.tsx packages/app/src/status-summary/global-status-bar.test.tsx packages/app/src/status-summary/status-bar-running-sessions.test.tsx`
3. `mise exec nodejs@22.20.0 -- npm run lint -- packages/app/src/status-summary/global-status-bar.tsx packages/app/src/status-summary/status-bar-running-sessions.tsx packages/app/src/status-summary/global-status-bar.test.tsx packages/app/src/status-summary/status-bar-running-sessions.test.tsx`
4. `mise exec nodejs@22.20.0 -- npm run typecheck`

## DoD 与 handoff

- 实现 gates、独立 code review、QA、acceptance 均通过后才完成。
- 每个阶段立即更新 `goal-state.yaml`，并在 step 级 ledger 记录进度。
- 若需要触碰 approved design、errors、协议/server/RPC/lifecycle，或独立 reviewer 失败/阻塞，先写 handoff state，再输出 `CS_FEATURE_GOAL_HANDOFF`。
