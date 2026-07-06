---
doc_type: roadmap-review
roadmap: global-status-bar
status: passed
reviewed: 2026-07-05
round: 2
---

# global-status-bar roadmap 审查报告

## 1. Scope And Inputs

- Roadmap: `.codestable/roadmap/global-status-bar/global-status-bar-roadmap.md`
- Items: `.codestable/roadmap/global-status-bar/global-status-bar-items.yaml`
- Related docs: `docs/architecture.md`, `docs/agent-lifecycle.md`, `docs/data-model.md`, `docs/design.md`, `docs/expo-router.md`, `docs/providers.md`, `docs/rpc-namespacing.md`, `docs/terminal-activity.md`
- Code facts checked: `packages/protocol/src/agent-types.ts`, `packages/protocol/src/messages.ts`, `packages/client/src/daemon-client.ts`, `packages/app/src/app/_layout.tsx`, `packages/app/src/app/h/[serverId]/_layout.tsx`, `packages/app/src/provider-usage/use-provider-usage.ts`, `packages/app/src/contexts/session-context.tsx`, `packages/app/src/utils/agent-snapshots.ts`, `packages/server/src/server/agent/agent-storage.ts`, `packages/server/src/server/agent/agent-manager.ts`, `packages/server/src/server/websocket-server.ts`, `packages/server/src/server/session.ts`

### Independent Review

- Status: completed
- Detection: paseo
- Provider / agent: `claude/opus`, agent `071a9729-6cc0-49ab-922c-f48b5ea8980c`
- Raw output: round 1 returned B1/I1/I2/I3/N1/N2/S1; round 2 targeted rereview confirmed all seven are resolved and found no new blocking/important
- Merge policy: round 1 findings were locally verified and merged into roadmap/items; round 2 result was checked against the revised roadmap
- Gate effect: none

## 2. Roadmap Summary

- Goal completion signal: host 内底部状态栏持续展示 persisted lifetime/today tokens、运行中和需处理 agent 摘要，并能导航到运行 session。
- Module split: Usage Ledger、daemon summary service、protocol/client SDK、app status store、global status bar UI 五层。
- Interface contracts: `status.summary.get.request/response`、`status.summary.updated`、`HostStatusSummaryPayload`、app view model。
- Items: 6 条；minimal loop 是 `usage-history-persistence`，随后 `status-summary-protocol` 暴露 RPC。
- Dependency shape: DAG；ledger → protocol → app store → UI shell → running session nav，hardening 最后收口。

## 3. Findings

### blocking

- none

### important

- none

### nit

- [ ] RMR-001 `Goal Coverage Matrix` 验证入口仍写了 `packages/server/src/server/session/...` 占位；实现期如果聚合落到 `status-summary/*` 或 `usage-ledger/*`，feature design 应把目标测试路径改准。
- [ ] RMR-002 `Usage Ledger` 落点在 `status-summary/*` 或 `usage-ledger/*` 之间尚未定；这是 item 1 design 的实现细节，需在设计阶段收口。

### suggestion

- [ ] RMR-003 `status.summary.updated` 实现时建议优先在 `docs/rpc-namespacing.md` 补一条 push/notification 命名约定；如果不改 docs，则至少在 protocol schema 附近注明 `.updated` 是无一一对应 response 的 server push。

### learning

- daemon 对 usage 是覆盖式 `lastUsage` 快照；today/lifetime 聚合必须依赖带时间戳、可去重的 usage ledger / persisted state。
- host-scoped chrome 比 app-global singleton 更符合当前 Expo Router host ownership；全局路由自动选择 earliest online host 留作未来扩展。

### praise

- 修订后先解决数据源，再暴露协议，再接 UI，依赖顺序可恢复。
- feature gate 单点化和无旧 daemon fallback 保持了协议/feature 契约边界。
- provider plan usage 已从 summary push 中移除，避免把 fetch-on-demand quota 查询变成隐式后台拉取。

## 4. User Review Focus

- 用户需要重点拍板：状态栏默认展示哪些指标；focus mode 是否隐藏；运行 session 快照 inline 展示数量上限。
- 后续 feature-design 需要重点复核：usage ledger schema、usage event merge semantics、host shell 底部布局和 safe-area/keyboard 避让。
- 不能靠 roadmap review 完全确认的点：各 provider 的 usage event 是累计快照还是增量，需要 `usage-history-persistence` design/implementation 用 provider fixtures 核验。

## 5. Evidence Confidence Ledger

| Check                        | Verdict | Evidence Class | Basis                                                                                           | Follow-up                      |
| ---------------------------- | ------- | -------------- | ----------------------------------------------------------------------------------------------- | ------------------------------ |
| Granularity Gate             | pass    | E              | roadmap 第 2 节说明跨 daemon/protocol/app/UI，items 拆为 6 条                                   | none                           |
| Goal Coverage Matrix         | pass    | E              | roadmap 第 5 节每个核心目标映射到 item 和验证入口                                               | 实现期校准目标测试路径         |
| DAG and minimal loop         | pass    | E              | items.yaml 通过 `validate-yaml.py`，只有 `usage-history-persistence` 标 `minimal_loop: true`    | none                           |
| Interface contract usability | pass    | E/C            | roadmap 第 4 节给出 RPC、push message、DTO、view model；push 命名约束已注明                     | none                           |
| Module interface depth       | pass    | C              | usage ledger 和 summary service 隔离 provider merge/window 复杂度；app store 隔离 UI 与协议细节 | item 1 design 收口 ledger 落点 |

Summary: E=4, C=1, H=0, H-only core checks=none。

## 6. Residual Risk

- Provider usage event 语义仍需实现期验证。roadmap 已把 ledger 作为第一条 feature，并要求跨天、daemon 重启、archived agent 三种证据。
- 底部状态栏可能影响 workspace composer 和 compact gesture。roadmap 已安排 UI shell 和 hardening 两条独立 feature，并要求截图/手工 QA。

## 7. Verdict

- Status: passed
- Next: 交给用户 review。用户确认后可把 roadmap `status` 改为 `active`，再进入子 feature design 或 goal-package。
