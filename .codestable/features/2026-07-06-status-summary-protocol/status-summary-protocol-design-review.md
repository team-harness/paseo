---
doc_type: feature-design-review
feature: 2026-07-06-status-summary-protocol
status: passed
reviewed: 2026-07-06
round: 2
---

# status-summary-protocol feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-design.md`
- Checklist: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-checklist.yaml`
- Roadmap: `.codestable/roadmap/global-status-bar/global-status-bar-roadmap.md`, `.codestable/roadmap/global-status-bar/global-status-bar-items.yaml`
- Related docs: `.codestable/attention.md`, `docs/rpc-namespacing.md`, `docs/architecture.md`, `docs/data-model.md`, `docs/agent-lifecycle.md`, `docs/providers.md`, `docs/testing.md`
- Code facts checked: `packages/protocol/src/messages.ts`, `packages/protocol/src/agent-state-bucket.ts`, `packages/server/src/server/session.ts`, `packages/server/src/server/websocket-server.ts`, `packages/client/src/daemon-client.ts`, `packages/server/src/server/agent/agent-manager.ts`, `packages/server/src/server/agent/agent-projections.ts`

### Independent Review

- Status: completed
- Detection: paseo
- Provider / agent: `providers.audit = claude/opus`; reviewer `3164153f-47df-48dc-9e60-20a2406c1aa2`
- Raw output: 用户消息中的 `<paseo-system>` 回传
- Merge policy: 已逐条合并 reviewer finding；无剩余 blocking / important

## 2. Design Summary

- Goal: 定义 host status summary 的 protocol/schema/server/client 最小闭环，使新 daemon 可通过 RPC 返回 persisted lifetime/today usage 和 active activity snapshot。
- Key contracts: `status.summary.get.request/response` correlated RPC；`status.summary.updated` full snapshot push；`server_info.features.statusSummary` gate；daemon singleton `StatusSummaryService` deep module。
- Steps: 6 步，覆盖 protocol、service、server wiring、client SDK、push 命名说明、验证。
- Checks: 覆盖 DTO、RPC、push、feature gate、service singleton、AgentManager 事件触发、activity counts 映射、recentlyCompleted 窗口、error、parent label、范围守护和验证。
- Baseline / validation: protocol messages target test、server status-summary service test、session target test、client daemon-client target test、typecheck/lint/format。

## 3. Findings

### blocking

none

### important

- [x] FDR-101 summary service 实例归属与 `notifyMayHaveChanged` 触发源已明确
  - Reviewer concern: design 把 “ledger usage events” 写成触发源，但前置 `UsageLedger` 没有 subscribe/event API；若每个 `Session` 各自 new service，会产生 N 份聚合和 coalescing timer。
  - Resolution: design §1/§2.1/§2.2/§2.3 明确 `StatusSummaryService` 在 `bootstrap.ts` 作为 daemon singleton 创建并注入 `Session`；service 拥有 coalescing timer；session 只 `getSummary()` 和 `subscribe(...)`。触发源收敛为 `AgentManager.subscribe()` 的 `agent_state` / `agent_stream` 两类事件，删除不存在的 ledger event 触发。
  - Verification hook: checklist 增加 singleton/coalescing ownership 与 AgentManager-only trigger checks。

- [x] FDR-102 `activity.counts` 分类学已定义为可测试互斥映射
  - Reviewer concern: `running/needsAttention/idle/error` 既不等于 lifecycle status，也不等于 existing workspace bucket，running 且 attention、initializing、closed 等边界不可判定。
  - Resolution: design §2.1 新增 counts 表：复用 `deriveAgentStateBucket` / `getAgentStatusPriority`；`needsAttention = needs_input|attention`，`error = failed`，`running = status initializing 或 bucket running`，`idle = bucket done 且非 initializing/closed`，`closed` 不计入 v1 活跃 counts。每个非 closed agent 只进一个 count。
  - Verification hook: checklist 增加 permission/error/running/initializing/attention/idle/closed 映射 check；service test 必须覆盖。

- [x] FDR-103 response shape 与 roadmap 示例偏差已说明为 intentional compatibility correction
  - Reviewer concern: roadmap §4.1 写顶层 `requestId`，但 client correlated layer 要求 response `payload.requestId`；若按 roadmap 字面会导致 SDK 类型推导不通。
  - Resolution: design §2.1 加注：roadmap §4.1 是早期示例，实现采用 `payload.{requestId,summary}`，这是 `DaemonClient.sendNamespacedCorrelatedSessionRequest` / `CorrelatedResponseMessage` 的硬约束。checklist 对 RPC check 同步改为 response 使用 `payload.{requestId,summary}`。
  - Verification hook: protocol/client target test 覆盖 correlated RPC shape。

### nit / suggestion resolved

- [x] parent id 派生 reuse：design §2.1 明确复用 `getParentAgentIdFromLabels(labels)`，client 不解析 labels。
- [x] recently completed window：design §2.1 固定 v1 为 injected clock 最近 15 分钟，checklist 要求窗口内外测试。
- [x] eventual consistency：design §2.2 明确前置 ledger `enqueueEvent` 非阻塞导致 summary push 可短暂滞后一拍，get 返回计算当刻 ledger 可见状态。

### residual-risk

- 旧 client 收到未知 `status.summary.updated` 会被 protocol parse 安全丢弃但可能产生 warn 日志；push 已 coalesce，噪声有界，非阻塞。
- `recentlyCompletedAgents` 的 15 分钟窗口是 v1 产品取舍，后续 UI hardening 可按实际密度调整，但本 feature 必须先固定测试口径。

### praise

- feature gate 单点、无旧 daemon fallback，符合项目 feature contract。
- provider plan usage 被明确排除，不会从 summary push 触发 quota fetch。
- summary service deep module 边界清晰，避免把 usage/window/activity 聚合散进 `session.ts` 或 app store。

## 4. User Review Focus

- 用户需要重点拍板：本 feature 只完成协议/daemon/client SDK 数据闭环，不做 app store/UI。
- implement 需要重点遵守：summary service 是 daemon singleton；push 是 full snapshot、coalesced、无 response；get response 是 reconnect 后权威值。
- code review / QA / acceptance 需要重点复核：feature gate 单点、provider usage 排除、counts 互斥映射、push 命名说明、rpc_error 失败路径。

## 5. Evidence Confidence Ledger

| Check                         | Verdict | Evidence Class | Basis                                                                                                    | Follow-up                   |
| ----------------------------- | ------- | -------------- | -------------------------------------------------------------------------------------------------------- | --------------------------- |
| Acceptance Coverage Matrix    | pass    | E              | design 3.3 覆盖 protocol/service/session/client/gate/provider-exclusion/push-doc/counts/window/singleton | implementation target tests |
| DoD Contract                  | pass    | E              | design 3.4 与 checklist `dod.commands` 均列出 core commands 和失败处理                                   | implementation evidence     |
| Steps and checks traceability | pass    | E              | checklist steps/checks 均能追溯到 design 1-3 节，reviewer findings 已变成 checks                         | implementation evidence     |
| Roadmap contract compliance   | pass    | E/C            | design 覆盖 roadmap 要求；response shape 已说明为 correlated RPC compatibility correction                | 可选回写 roadmap 示例       |
| Module interface design       | pass    | E/C            | design 2.1/2.2 含 singleton ownership、ports、seam、trigger source、eventual consistency                 | code review                 |
| Validation and artifacts      | pass    | E              | checklist 列出目标测试、typecheck、lint、format、docs/schema comment                                     | QA                          |

Summary: E=5, C=1, H=0, H-only core checks=none。

## 6. Verdict

- Status: passed
- Rationale: 独立 reviewer 无 blocking；三项 important 均已修订进 design/checklist，且有明确实现期验证入口。设计可进入 epic child batch 的下一项。
