---
doc_type: feature-design-review
feature: 2026-07-06-app-status-summary-store
status: passed
reviewed: 2026-07-06
round: 2
---

# app-status-summary-store feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-design.md`
- Checklist: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-checklist.yaml`
- Intent / brainstorm: none
- Roadmap: `.codestable/roadmap/global-status-bar/global-status-bar-roadmap.md`, `.codestable/roadmap/global-status-bar/global-status-bar-items.yaml`
- Related docs: `.codestable/attention.md`, `docs/coding-standards.md`, `docs/expo-router.md`, `docs/architecture.md`, `docs/rpc-namespacing.md`, `docs/testing.md`, `docs/glossary.md`
- Code facts checked: `packages/app/src/runtime/host-runtime.ts`, `packages/app/src/runtime/host-features.ts`, `packages/app/src/contexts/session-context.tsx`, `packages/app/src/stores/session-store.ts`, `packages/app/src/provider-usage/use-provider-usage.ts`, `packages/app/src/hooks/use-providers-snapshot.ts`, `packages/app/src/hooks/use-client-activity.ts`, `packages/client/src/daemon-client.ts`, `packages/protocol/src/messages.ts`

### Independent Review

- Status: completed
- Detection: paseo
- Provider / agent: `providers.audit = claude/opus`; reviewer `360820eb-ddcd-458a-aea0-3e27ec5f36aa`
- Raw output: 用户消息中的 `<paseo-system>` 回传
- Merge policy: 已逐条合并 reviewer finding；无剩余 blocking / important

## 2. Design Summary

- Goal: app 按 host 接入 `status.summary` get/push，维护 cache、capability gate、常驻 refresh，并提供底部状态栏可消费 view model。
- Key contracts: query key `["statusSummary", serverId]`；只在 online + `features.statusSummary` 时 fetch；`staleTime: Infinity`；SessionProvider 用 `fetchQuery` / `prefetchQuery` 做初连/重连/resume refresh；push 是 full snapshot replace；unsupported 不 fallback。
- Steps: 5 步，覆盖 query/cache、push apply、reconnect refresh、view model、验证。
- Checks: 覆盖 serverId 隔离、feature gate、observer-independent refresh、unsupported fallback 禁止、push replace、subscription cleanup、offline/error previous summary、view model 输出、roadmap reconciliation、范围守护和验证。
- Baseline / validation: app status-summary 目标 tests、SessionProvider target test、typecheck/lint/format、grep 反向核对。

## 3. Findings

### blocking

none

### important

- [x] FDR-101 roadmap §4.4 view model 契约偏差已显式 reconciliation
  - Reviewer concern: roadmap §4.4 示例是 `useHostStatusSummary` / `useGlobalStatusBarView`、`hidden.reason` 含 `focus-mode`、`StatusBarRow.target` 含导航目标；design 静默改成 `useStatusSummary`、顶层 `unsupported/offline`、固定 row id 和 `runningSessions` 列表，会让后续 shell feature 与 roadmap 漂移。
  - Resolution: design §1 新增 “Roadmap §4.4 契约 reconciliation”：hook 命名对齐 `useHostStatusSummary` / `useGlobalStatusBarView`；`unsupported/offline` 属 app store 状态；`focus-mode` 归 shell；`StatusBarRow.target` 和导航归 `status-bar-running-sessions-nav`；row `kind` 可由 shell 从稳定 `id` 派生。view model 字段改为 `runningAgents/needsAttentionAgents/recentlyCompletedAgents`，与 DTO 口径一致。
  - Verification hook: checklist 增加 roadmap reconciliation check。

- [x] FDR-102 reconnect/initial refresh 不再依赖 active observer
  - Reviewer concern: 只靠 hook query 与 `invalidateQueries` 会在 status bar shell 未挂载时无 observer，inactive query 只 stale 不 refetch，违背 host-scoped 常驻 cache 意图。
  - Resolution: design §1/§2.1/§2.2/§2.4/§3 明确初连、重连、app resume refresh 由 `SessionProvider` 命令式 `queryClient.fetchQuery` / `prefetchQuery` 触发；hook 只读 cache 并做兜底 fetch；query `staleTime: Infinity`，freshness 来自 push 与 explicit refresh。
  - Verification hook: checklist steps/checks 要求无 UI observer 时重连仍触发 fetch，且不能只 `invalidateQueries` inactive query。

### nit / suggestion resolved

- [x] N1 命名消歧：view model 字段对齐 DTO 的 `*Agents`，避免裸 `Session` 术语二义。
- [x] N2 staleTime 明确：query `staleTime: Infinity`，由 push 与 explicit refresh 控制 freshness。
- [x] N3 grep 范围收紧：status-summary 目录做 token grep，`session-context.tsx` 只做新增 push handler diff review，避免未来无关 token 误报。
- [x] S1 reconnect seam 锁定：refresh 触发点落在 `SessionProvider` 连接生命周期，不让 hook 自行 watch 成第二套机制。

### residual-risk

- 前置 `status-summary-protocol` 仍是 design passed / implementation 未落地；本 feature 实现必须等 `HostStatusSummaryPayload`、`status.summary.updated`、`DaemonClient.getStatusSummary()` 真正存在后启动，否则 type import 会失败。这是已声明依赖，不阻塞 design。
- push 写入 disabled query cache 的理论边界由 capability gate 兜底；unsupported view model 优先级必须在实现中保持。

### praise

- feature gate 单点、无旧 daemon fallback、反向 grep 明确，符合项目 feature contract。
- 不扩张 `session-store.ts`，复用 React Query + host-features + host-runtime server-state 范式，结构边界清晰。
- query/cache 层与 view model 层分离，下游 status bar shell 只读 `kind` 和 rows/lists，不碰 daemon client。

## 4. User Review Focus

- 用户需要重点拍板：本 feature 仍不做底部栏 UI，只交付 app 数据接入与 view model。
- implement 需要重点遵守：feature gate 单点、push full snapshot replace、SessionProvider 命令式 refresh、unsupported 不调用旧 RPC。
- code review / QA / acceptance 需要重点复核：serverId query key 隔离、subscription cleanup、push-after-error 状态、无 observer refresh、roadmap §4.4 reconciliation、范围守护 grep。

## 5. Evidence Confidence Ledger

| Check                         | Verdict | Evidence Class | Basis                                                                                             | Follow-up                   |
| ----------------------------- | ------- | -------------- | ------------------------------------------------------------------------------------------------- | --------------------------- |
| Acceptance Coverage Matrix    | pass    | E              | design 3.3 覆盖 query/push/reconnect/view model/unsupported/no UI                                 | implementation target tests |
| DoD Contract                  | pass    | E              | design 3.4 与 checklist `dod.commands` 列出 core commands 和失败处理                              | implementation evidence     |
| Steps and checks traceability | pass    | E              | checklist steps/checks 均能追溯到 design 2-3 节，reviewer findings 已变成 checks                  | implementation evidence     |
| Roadmap contract compliance   | pass    | E/C            | design §1 显式 reconciliation roadmap §4.4，未静默漂移                                            | code review / acceptance    |
| Module interface design       | pass    | E/C            | design 2.1/2.2 含 query/push/view-model seam、SessionProvider refresh seam 和 dependency strategy | code review                 |
| Validation and artifacts      | pass    | E              | checklist 列出目标 tests、typecheck、lint、format、grep                                           | QA                          |

Summary: E=5, C=1, H=0, H-only core checks=none。

## 6. Verdict

- Status: passed
- Rationale: 独立 reviewer 无 blocking；两项 important 和三项 nit/suggestion 均已修订进 design/checklist，且有明确实现期验证入口。设计可进入 epic child batch 的下一项。
