---
doc_type: feature-review
feature: 2026-07-06-status-summary-protocol
status: passed
reviewer: subagent+ocr
reviewed: 2026-07-06
round: 1
---

# status-summary-protocol 代码审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-design.md`
- Checklist: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-checklist.yaml`
- Evidence pack: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-evidence-pack.md`
- Gate results: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-scope-gate.json`
- DoD results: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-dod-results.json`
- Implementation evidence: 当前工作区 diff、fresh DoD runner evidence、Paseo reviewer agent 输出、OCR 输出和本地事实核验。
- Diff basis: `git status --short` + `git diff --stat`，本轮实现文件为 protocol schema/tests、server status summary service/tests、Session/WebSocket/bootstrap wiring、client SDK/tests 和 feature 产物。
- Baseline dirty files: 当前 dirty files 均属于 `status-summary-protocol` 允许路径；第 1 个 feature 已提交。

### Independent Review

- Detection: Paseo MCP 可用，独立 Paseo subagent 已完成；OCR CLI 结果已由上一轮主 agent 核验并回传。
- 环节 A 独立隔离 Task agent: `paseo` + `completed`，agent `5e68e23f-f586-4bbc-be63-31a217e60169`，只读 review，无 blocking / important。
- 环节 B OCR CLI: `completed`。OCR 提出的有效项已本地核验：service dispose、DaemonClient 显式泛型、`COMPAT(statusSummary)` 版本、high-level SDK facade 覆盖均已修复或补测。
- OCR severity mapping: High->blocking/important, Medium->nit/suggestion, Low->discarded；所有外部 finding 均按仓库事实核验后合并或驳回。
- Merge policy: subagent 和 OCR 结果已逐条本地核验；未确认的运行时边界进入 QA focus / residual risk，不升级为 blocking。
- Gate effect: `reviewer: subagent+ocr` 满足 review gate 放行锚点。

## 2. Diff Summary

- 新增：`packages/server/src/server/status-summary/status-summary-service.ts`、`status-summary-service.test.ts`、本 feature gate/evidence artifacts。
- 修改：protocol messages/tests、server session/tests、websocket server、bootstrap、client daemon client/tests、SDK facade/tests、feature checklist。
- 删除：none
- 未跟踪 / staged：新增 service files 和 feature artifacts 未跟踪；无 staged diff。
- 风险热点：协议兼容、server singleton 生命周期、push coalescing、usage ledger read fallback、client RPC correlation。

## 3. Adversarial Pass

- 假设的生产 bug：status summary service 作为 daemon singleton 订阅 agent events 后未释放，导致 daemon stop/restart 测试或嵌入式生命周期泄漏 listener/timer。
- 主动攻击过的反例：ledger read 抛错、listener throw、多 session 订阅、agent_stream 高频推送、closed/initializing/error/permission 状态映射、`status.summary.updated` 无 response 命名、old client unknown push parse、high-level SDK 未暴露新能力。
- 结果：service dispose 已在 bootstrap stop 路径接入；ledger throw fallback、listener 隔离、coalesced push、状态映射和 client facade 均有测试或类型覆盖。无 blocking / important。

## 4. Findings

### blocking

- none

### important

- none

### nit

- [ ] REV-001 `packages/server/src/server/status-summary/status-summary-service.ts:48` 默认 coalesce window 为 `250ms`，当前没有常量注释解释选择。影响是可调优性，不影响 correctness。

### suggestion

- [ ] REV-002 发布版本变化时，release 负责人应确认 `COMPAT(statusSummary): added in v0.1.104` 是否仍准确。
- [ ] REV-003 后续 app store feature 应集中读取 `server_info.features.statusSummary`，不要在 UI 或 hook 中散落旧 daemon fallback。

### learning

- Status summary 作为 host 级 DTO 时，server 聚合层必须保持 deep module：usage ledger 容错、agent state bucket 口径和 local-day window 都不应泄漏到 app store 或 UI。

### praise

- `StatusSummaryService` 集中聚合 lifetime/today usage 和 activity DTO，Session 只做 RPC/push wiring，边界清楚。
- `status.summary.get.response` 使用 `payload.{requestId, summary}`，符合现有 namespaced correlated RPC helper。
- service 对 ledger read 和 listener emit 都做隔离日志，不让 usage summary 影响 daemon lifecycle。

## 5. Test And QA Focus

- QA 必须重点复核：protocol/server/session/client 目标测试、`npm run typecheck`、`npm run lint`、`npm run format:check`。
- Evidence pack residual risks / gate warnings：scope gate、DoD runner、evidence pack 均 passed 且无 warning。
- 已补强测试：high-level SDK facade `status.summary()` / `status.subscribe()`。
- 不能靠 review 完全确认的点：多真实客户端同时连接时的 push fan-out、daemon 本地时区变化中的 day boundary、failed agents 是否只在 counts 而不在 lists 的产品口径。

## 6. Residual Risk

- `activity.counts.error` 会包含 failed/error agents，但 v1 lists 只有 running / needsAttention / recentlyCompleted；这符合 design，但 UI copy 后续要避免让用户以为 error list 已存在。
- `byProvider` / `byModel` v1 为空数组；schema 已保留字段，后续分桶功能需要从 usage ledger record 维度扩展。
- today window 使用 daemon local day；daemon 运行中切换系统时区的表现未做专门测试。

## 7. Verdict

- Status: passed
- Next: 进入 `cs-feat` QA 阶段。
