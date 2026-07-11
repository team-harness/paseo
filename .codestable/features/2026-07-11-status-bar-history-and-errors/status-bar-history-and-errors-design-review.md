---
doc_type: feature-design-review
feature: 2026-07-11-status-bar-history-and-errors
status: passed
reviewed: 2026-07-11
round: 4
---

# Status bar 历史与会话状态 UI feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-design.md`
- Checklist: `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-checklist.yaml`
- Intent / brainstorm: none
- Roadmap: standalone post-roadmap UI follow-up；核对 `global-status-bar` roadmap 的只读、单一 summary 数据流和无旧 RPC fan-out 约束。
- Related docs: `docs/agent-lifecycle.md`、`docs/design.md`、`docs/hover.md`
- Code facts checked: `global-status-bar.tsx`、`status-bar-running-sessions.tsx`、`status-bar-running-sessions.test.tsx`、`global-status-bar.test.tsx`、`agent-labels.ts`

### Independent Review

- Status: completed
- Detection: paseo
- Provider / agent: 配置的 `claude/opus` 不可用，按审计偏好回退至 `codex/gpt-5.5` 计划模式；agent `14a41c9b-2fcc-4ab7-a11f-77d768b9f4bf`
- Raw output: 无 blocking；确认 history 在已加载集合内过滤、静态/交互组件边界和 app-only 范围成立。
- Merge policy: 已逐条按 design、checklist、现有组件与测试核验。
- Gate effect: independent review completed，可以进入用户整体 review。

## 2. Design Summary

- Goal: status bar history 过滤关闭/子 agent；空闲和活跃状态均使用同形的会话状态区域；errors 保持静态。
- Key contracts: history 只在 `useAgentHistory` 已加载集合内先过滤再截断；无会话时只挂载静态视图；有会话时才挂载交互 trigger、overlay 与 navigation。
- Steps: 4 个，覆盖 history 选择、统一布局、静态交互边界和回归验证。
- Checks: 7 个，覆盖可见性、固定 UI、可访问性、范围守护与验收场景。
- Baseline / validation: 两个 status-summary 目标测试，加 format、lint、typecheck。

## 3. Findings

### blocking

none

### important

none

### nit

none

### suggestion

- [ ] FDR-001 实现静态视图时使用 `testID="status-bar-sessions-static"`，与既有可交互的 `status-bar-sessions-trigger` 区分。
  - Evidence: 空闲视图和 interactive trigger 均复用 `TriggerContent`，目标测试需直接观察它们的不同可访问性和 overlay 生命周期。
  - Impact: 不改变产品契约，只提高测试的可观测性。

### learning

- feature design 在用户确认前必须保持 `draft`，checklist 的 steps/checks 必须保持 `pending`；这不是未完成定稿信号，而是本阶段的正常 gate 状态。
- 当前目标测试断言旧的空闲 running chip 行为，是 implementation 要替换的基线，不是设计缺口；CMD-001 必须随实现更新为静态视图断言。

### praise

- history 复用 `getParentAgentIdFromLabels`，与 closed lifecycle 和子 agent 标签的既有语义一致。
- 静态路径明确不挂载 state、effect、Pressable、DropdownMenu 或 sheet，避免“外部不可点、内部仍有交互生命周期”的半实现。
- 范围严格限制在 app UI：不改 errors、daemon、protocol、RPC 或 lifecycle。

## 4. User Review Focus

- 用户需要重点拍板：空闲时显示同形的会话状态静态视图，而不是原来的 running/attention 两个零值 chips。
- implement 需要重点遵守：selector 先决定 static/interactive 组件；不能在已创建 open state/effect 后才决定空闲分支。
- code review / QA / acceptance 需要重点复核：静态视图不是 button、没有 panel/sheet，history 只在已加载集合内补足十条，errors 不被改动。

## 5. Evidence Confidence Ledger

| Check                         | Verdict | Evidence Class | Basis                                                                              | Follow-up                             |
| ----------------------------- | ------- | -------------- | ---------------------------------------------------------------------------------- | ------------------------------------- |
| Acceptance Coverage Matrix    | pass    | E              | design 第 3 节覆盖 history、静态空闲、活跃 overlay、attention 零值与 errors 静态性 | 实现后跑 CMD-001                      |
| DoD Contract                  | pass    | E              | design 与 checklist 的 CMD-001 至 CMD-004 一致                                     | 按 checklist 留存命令证据             |
| Steps and checks traceability | pass    | E              | 4 steps、7 checks 均可追溯到第 2/3 节                                              | 实现时更新 steps 状态                 |
| Roadmap contract compliance   | pass    | C              | 未新增 status summary/RPC，保持只读导航边界                                        | standalone follow-up 不回写 done item |
| Module interface design       | pass    | C              | 无新增 interface，static/interactive 仅是 app 内组件边界                           | code review 核对 state ownership      |
| Validation and artifacts      | pass    | E              | app-only 目标测试和静态范围守护可执行                                              | 更新旧空闲 UI 测试断言                |

Summary: E=4, C=2, H=0, H-only core checks=none。

## 6. Residual Risk

- 当前代码和测试仍是旧行为；实现必须同时修改 `global-status-bar.tsx`、`status-bar-running-sessions.tsx` 及对应目标测试，才能证明设计契约。

## 7. Verdict

- Status: passed
- Next: 交给用户整体 review；用户确认 design 后生成 goal package 并进入实现。
