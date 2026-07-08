---
doc_type: feature-design-review
feature: 2026-07-08-status-bar-session-pins
status: passed
reviewed: 2026-07-08
round: 3
---

# status-bar-session-pins feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-08-status-bar-session-pins/status-bar-session-pins-design.md`
- Checklist: `.codestable/features/2026-07-08-status-bar-session-pins/status-bar-session-pins-checklist.yaml`
- User feedback: Pin 状态应像 status bar 统计一样跟随 host，而不是 app 本地缓存。
- Related docs: `docs/architecture.md`, `docs/data-model.md`, `docs/protocol-validation.md`, `docs/rpc-namespacing.md`, `docs/design.md`
- Code facts checked: `packages/protocol/src/messages.ts`, `packages/server/src/server/status-summary/status-summary-service.ts`, `packages/server/src/server/session.ts`, `packages/client/src/daemon-client.ts`, `packages/app/src/status-summary/*`

### Independent Review

- Status: completed
- Provider / agent: `codex/gpt-5.5`, agent `709672aa-12cc-4dd7-808f-ea5e748e255b`
- Raw output source: user-delivered Paseo notification for `[Advisor] Review status bar session pins design`
- Verdict: passed, no blocking findings
- Merge policy: advisor 的 important/nit findings 已全部合并到 design/checklist；无 finding 需要降级为 blocking。

## 2. Design Summary

- Goal: 在状态栏 sessions/history 列表中固定 agent/session，并在 History 旁提供 pinned session 快捷列表；Pin 状态由 host/daemon 持久化并通过 status summary 同步给客户端。
- Key contracts: host-owned store；summary additive `pinnedSessions`; dotted set RPC；server_info feature gate；mutation 后广播 `status.summary.updated`；app 不使用 AsyncStorage 保存 session pin。
- Steps: 6 步，覆盖协议/store/data-model docs、server/client/bootstrap wiring、server feature flag + app capability、row toggle、Pin list、scope guard。
- Checks: 9 条，覆盖 host 归属、协议纯声明、capability gate、row 交互、去重/导航、summary broadcast、生命周期禁区、data model docs、COMPAT 真实版本号。

## 3. Findings

### blocking

none.

### important

none.

已解决的重要修订：

- I-1 原设计把 Pin 当作 `client-local UI preference`，与用户期望冲突。已改为 daemon host-owned `SessionPinStore`，跟随 status summary。
- I-2 原设计复用 `workspace-pins` AsyncStorage store，语义混淆。已改为 app-local workspace pins 不参与本 feature。
- I-3 原 design DoD 禁止 protocol/server diff，但 host-owned Pin 必须改协议与 daemon。已改为 additive protocol + daemon store + RPC 的正向交付物，并保留 lifecycle/route 越界 grep。
- I-4 advisor 指出 checklist 未锁住真实 daemon bootstrap wiring。已在 S2/设计推进策略中加入 bootstrap 构造同一 `SessionPinStore` 并注入 `StatusSummaryService` 与 mutation 链路的退出信号。
- I-5 advisor 指出新增 `$PASEO_HOME/status-summary/session-pins.json` 需要同步 `docs/data-model.md`。已在 S1、C8、交付物和挂载点中加入数据模型文档更新。
- I-6 advisor 指出 checklist 未明确 server_info feature flag 服务端落点。已在 S3/C3 中加入 server_info schema/payload 暴露 `features.statusBarSessionPins`。

### nit

- N-1 advisor 建议防止 `v0.1.X` COMPAT 占位落地。已新增 C9 和 CMD-011 grep，要求实现期替换真实版本号。

### residual risk

- R1 新增 RPC 与 summary 字段会触碰协议生成/类型链路；实现期必须运行 protocol/client/server/app 目标测试和 typecheck。
- R2 feature flag 版本号需实现期填真实版本；checklist 已用 CMD-011 阻止 `v0.1.X` 占位进入代码。
- R3 多客户端同步依赖 mutation 后 summary broadcast；如果实现只更新本客户端响应而不广播，会违反核心需求。

## 4. Required Checks

- Spec coverage: pass。用户要求的 host-owned Pin、sessions/history 行内 Pin、History 旁 Pin 入口、固定列表和快速进入均映射到 S1-S5。
- Placeholder scan: pass。除实现期版本号 `v0.1.X` 外，无 TBD/同上一步/适当处理等占位；版本号作为兼容注释模板由实现填实。
- Terminology/type consistency: pass。全文使用 host-owned session pin / pinned session，不与 app-local workspace tab pin 混用。
- Protocol compatibility: pass。Summary 字段 additive optional；新功能通过 feature flag gate；new RPC 使用 dotted namespace。

## 5. User Review Focus

- 需要用户确认：Pin 是 per-host 状态，跨连接到同一 host 的客户端同步；不同 host 不同步。
- 实现重点：先做 daemon store + summary/RPC，再做 app UI；不能先用 AsyncStorage 临时代替。
- 验收重点：daemon 重启后 Pin 仍在；两个客户端连接同一 host 时 mutation 后都更新；旧 host 下不显示可操作 Pin。

## 6. Verdict

- Status: passed
- Next: 等用户确认 design 后，把 design `status` 改为 `approved`，进入 goal-package / implementation。
