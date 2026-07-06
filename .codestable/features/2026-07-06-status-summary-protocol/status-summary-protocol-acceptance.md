---
doc_type: feature-acceptance
feature: 2026-07-06-status-summary-protocol
status: passed
accepted: 2026-07-06
round: 1
---

# status-summary-protocol 验收报告

## 1. 接口契约核对

- [x] `status.summary.get.request` 使用 dotted namespace 和 `.request` 后缀。
- [x] `status.summary.get.response` 使用 `payload.{requestId, summary}`。
- [x] `status.summary.updated` 是无 response push，发送完整 `HostStatusSummaryPayload` snapshot。
- [x] `server_info.features.statusSummary` 是唯一 capability gate，带 `COMPAT(statusSummary): added in v0.1.104`。
- [x] `HostStatusSummaryPayload` 包含 `generatedAt`、usage lifetime/today/byProvider/byModel、activity lists/counts。

## 2. 行为与决策核对

- [x] protocol schema 定义 get request/response、updated push 和 payload types。
- [x] websocket server info 暴露 `features.statusSummary === true`。
- [x] server session 能处理 get request 并返回 current summary。
- [x] daemon singleton summary service 在 AgentManager event 后 coalesce 推送 updated。
- [x] client SDK 提供 `getStatusSummary()`，high-level facade 提供 `status.summary()` 和 `status.subscribe()`。
- [x] 未实现 app store/UI/navigation，未 fan out 旧 RPC，未调用 provider usage API，未改变 usage ledger merge semantics。

## 3. 验收场景核对

- [x] client get request -> daemon get response：`session.test.ts`、`daemon-client.test.ts` 通过。
- [x] persisted usage totals 输出 `totalTokens`：`status-summary-service.test.ts` 通过。
- [x] labels 派生 `parentAgentId`：`status-summary-service.test.ts` 通过。
- [x] agent event 变化 -> `status.summary.updated`：`session.test.ts` 通过。
- [x] permission/error/running/initializing/attention/idle/closed 互斥口径：service tests 和 code inspection 通过。
- [x] recently completed 15 分钟窗口：`status-summary-service.test.ts` 通过。
- [x] ledger 没有数据或 read throw -> 空 totals / activity fallback：`status-summary-service.test.ts` 通过。
- [x] old client unknown push 兼容：protocol add-only outbound union；server_info feature optional。
- [x] Review 和 QA 报告均 passed，residual risk 不承载核心验收缺口。

## 4. roadmap 回写

- [x] `.codestable/roadmap/global-status-bar/global-status-bar-items.yaml` 对应 item 从 `in-progress` 改为 `done`。
- [x] `.codestable/roadmap/global-status-bar/global-status-bar-roadmap.md` 第 5 节对应条目同步为 `状态：done`，`对应 feature：2026-07-06-status-summary-protocol`。
- [x] `.codestable/roadmap/global-status-bar/goal-state.yaml` 当前 feature index 前移到 `2`，本 feature 状态为 `accepted`。

## 5. 最终审计

- Evidence sources：`status-summary-protocol-evidence-pack.md` / `status-summary-protocol-dod-results.json` / `status-summary-protocol-scope-gate.json`
- 聚合命令：protocol/server/session/client/SDK facade 目标测试均 exit 0；`npm run typecheck`、`npm run lint`、`npm run format:check` 均 exit 0。
- 交付物复核：protocol / server / client SDK / feature gate / roadmap 均已落盘；requirement 无需回写。
- 结论：通过。
