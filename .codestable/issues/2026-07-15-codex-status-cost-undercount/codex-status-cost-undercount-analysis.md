---
doc_type: issue-analysis
issue: 2026-07-15-codex-status-cost-undercount
status: confirmed
root_cause_type: data-format
related:
  - codex-status-cost-undercount-report.md
tags:
  - status-summary
  - codex
  - usage-ledger
---

# Codex Status Cost Undercount 根因分析

## 1. 问题定位

| 关键位置                                                                    | 说明                                                                                                                        |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `packages/server/src/server/agent/providers/codex-app-server-agent.ts:876`  | `toAgentUsageForModel` 只读取 `tokenUsage.last`，把单次模型调用 Token 映射成 `AgentUsage`。                                 |
| `packages/server/src/server/agent/providers/codex-app-server-agent.ts:2100` | Paseo 对 `thread/tokenUsage/updated` 的 schema 接受 `threadId` 和 `tokenUsage`，但未保留 Codex 原生 `turnId`。              |
| `packages/server/src/server/agent/providers/codex-app-server-agent.ts:5402` | 每次通知直接覆盖 `latestUsage` 并发出 `usage_updated`，没有把同一 turn 的多次调用累加成单调快照。                           |
| `packages/server/src/server/agent/providers/codex-app-server-agent.ts:5311` | turn 开始/结束调用的 `resetTurnTrackingState` 没有清空 `latestUsage`，无 usage 通知的 completed turn 可复用上一 turn 的值。 |
| `packages/server/src/server/agent/providers/codex-app-server-agent.ts:4643` | Paseo turn id 使用进程内 `codex-turn-N`，session/daemon 重建后从 0 重用。                                                   |
| `packages/server/src/server/agent/agent-manager.ts:3455`                    | AgentManager 直接把 provider event turn id 用作持久化 `usageTurnKey`。                                                      |
| `packages/server/src/server/usage-ledger/index.ts:406`                      | ledger 的 basis key 为 `agentId + provider + usageTurnKey`，所以重用的 `codex-turn-N` 会命中旧 basis。                      |
| `packages/server/src/server/usage-ledger/index.ts:426`                      | ledger 明确要求同一 basis 的 usage 是单调累计快照；任一字段回退就把整条事件判为 stale。                                     |
| `packages/app/src/status-summary/use-status-summary.ts:22`                  | 全局 Status bar 已遍历所有已注册 Host，并对连接且支持 capability 的 Host 发起查询。                                         |
| `packages/app/src/status-summary/view-model.ts:113`                         | 多 Host view model 已对所有 ready summary 求和；第二台 Host 本次只有 `$0.135`，不是主要金额差异来源。                       |

本机 `codex-cli 0.144.1` 生成的 app-server TypeScript 协议进一步确认：

```ts
type ThreadTokenUsage = {
  total: TokenUsageBreakdown;
  last: TokenUsageBreakdown;
  modelContextWindow: number | null;
};

type ThreadTokenUsageUpdatedNotification = {
  threadId: string;
  turnId: string;
  tokenUsage: ThreadTokenUsage;
};
```

其中 `total` 是 thread 累计值，`last` 是最后一次模型调用值。现有测试 `codex-app-server-agent.test.ts:3759` 只覆盖单条 usage 通知，没有覆盖一个 turn 内的第二次调用。

## 2. 失败路径还原

**正常路径**：Codex 在一个 foreground turn 内完成多次模型调用 → adapter 把 thread 累计值归一化成“当前 Paseo turn 的单调累计 usage” → AgentManager 为该 turn 生成唯一 `usageTurnKey` → ledger 对递增快照做 delta → Status summary 汇总两个 Host 的 ledger totals。

**实际失败路径**：

1. Codex 第一次调用上报 `total.inputTokens = 28,730`、`last.inputTokens = 28,730`；adapter 发出 `28,730`，ledger 将其作为当前 turn 第一份累计快照。
2. 第二次调用上报 `total.inputTokens = 62,328`、`last.inputTokens = 33,598`；adapter 只发 `33,598`。
3. ledger 把 `33,598` 误解为当前 turn 的新累计值，只记录 `4,868`，因此当前 turn 被记成 `33,598`，实际已经是 `62,328`。
4. 后续某次 `last` 小于前一次 `last` 时，ledger 在 `computeContribution` 返回 `stale`，整条 usage 被丢弃。
5. `turn_completed` 仅重复最后一次 `latestUsage`，无法补回此前丢失的调用。
6. daemon/session 重建后 `codex-turn-N` 从 0 重新开始；旧 agent 的新 turn 可能命中已持久化的同名 basis，再次只记差值或直接 stale。

**分叉点**：`packages/server/src/server/agent/providers/codex-app-server-agent.ts:882` — provider adapter 选择了单次调用的 `last`，但下游 contract 要求 turn-scoped 单调累计快照。

生产数据与该路径一致：两台 Host 分别记录超过 `2600` 与 `2138` 条 Codex stale；Host 1 有 7 个 Codex basis key 跨越 daemon 重启前后继续写入，证明进程内 ordinal 确实与持久化 basis 发生碰撞。

## 3. 根因

**根因类型**：data-format（主）+ state-pollution / logic（次）

**根因描述**：Usage ledger 的输入 contract 是“同一 Paseo turn 内单调递增的累计快照”，但 Codex adapter 把 app-server 的“最后一次模型调用值”直接当作该累计快照。两种数据语义不一致，导致 ledger 只记录相邻 `last` 的正差，或在字段下降时丢弃整条事件。与此同时，adapter 的 turn id 只在单个进程内唯一，却被用作跨重启持久化 basis；`latestUsage` 也没有随 turn 清空。这些状态边界问题会继续制造少记、stale，少数边界下也可能重复计费。

**是否有多个根因**：是。

1. **主根因**：`last` 单次调用值与 ledger turn 累计 contract 不匹配。
2. **次根因**：`codex-turn-N` 在 session/daemon 重建后重用，碰撞旧 basis。
3. **防御缺口**：未保留原生 `turnId`，且 `latestUsage` 不随 turn 清空，无法拒绝迟到通知或避免上一 turn 状态泄漏。

多 Host 聚合不是本次主根因：现有 app 代码和测试已经对多个 ready Host 的费用求和；第二台 Host 自身错误 ledger 只有 `$0.135`，是否被短暂排除都无法解释近 `$700` 的主要差额。

## 4. 影响面

- **影响范围**：所有通过 Codex app-server 运行、单个 foreground turn 含多次模型调用的 Paseo agent；长 turn、工具循环、reasoning 较多的会话最严重。
- **潜在受害模块**：agent `lastUsage`、usage ledger、Status summary 的 today/lifetime Token 与费用、依赖该 summary 的全局 Status bar。
- **多 Host 行为**：每台 Host 会先独立少记，再由客户端正确相加；Host 数量增加不会修复单机少记。
- **daemon 重启 / resume**：相同 agent 恢复后可能重用 ordinal basis，继续少记或 stale。
- **provider subagent**：Codex 内建 child thread 的 token notification 当前被 subagent routing 忽略；它不属于本次已映射 root-thread 差额的必要修复，但仍是网关与 Paseo-managed totals 的遗留范围。
- **数据完整性风险**：有。stale 事件没有写入 ledger，单靠现有 ledger 无法无损恢复历史；自动按网关总额回填又会混入非 Paseo 请求。
- **严重程度复核**：维持 P1。核心可观测性稳定失真，但不阻塞 agent 执行，也不直接改变网关实际计费。

## 5. 修复方案

### 方案 A：在 Codex adapter 归一化为 per-turn 单调累计值（推荐）

- **做什么**：
  - 解析 app-server 的 `total`、`last` 和原生 `turnId`。
  - session 内保存上一份 thread `total`，用累计差值识别本次新增 Token；首次观察、resume 或累计回退时以 `last` 作为安全基线。
  - 把新增 Token 累加到当前 Paseo turn 的 accumulator，向 ledger 始终发送单调累计快照；相同 `total` 的重复通知不增加费用。
  - turn 开始/结束清空 per-turn accumulator 与 `latestUsage`，thread 开始清空 thread baseline。
  - Paseo foreground turn id 改为 `codex-turn-${randomUUID()}`，避免持久化 basis 跨 session/daemon 碰撞。
  - 补齐多请求递增/下降、重复通知、跨 turn、resume 首通知、迟到旧 turn、唯一 turn id 的目标测试。
- **优点**：在 provider 边界修正错误语义；ledger、持久化 schema、Status summary 和 app 多 Host 聚合都无需改变；首次 resume 不会把整个 thread 历史重复计入。
- **缺点 / 风险**：只保证修复后新事件正确，既有少记历史仍保留；child thread usage 仍需后续单独定义归属。
- **影响面**：生产代码仅修改 Codex adapter；测试修改 Codex adapter test，并更新 usage contract 文档。

### 方案 B：让 ledger 对 Codex 使用 session-scoped `total` basis

- **做什么**：adapter 直接上报 `tokenUsage.total`；ledger 为 Codex 新增 session-scoped token/cost basis，绕开 turn-scoped delta。
- **优点**：累计语义集中在持久层，session 内天然去重，理论上更容易跨 daemon 重启续算。
- **缺点 / 风险**：首次观察一个已有 thread 时无法区分“本次 Paseo turn”与历史累计，容易一次性重复计入整个 session；需要修改 ledger contract/schema、查询和迁移逻辑，并处理 thread reset/compaction。
- **影响面**：Codex adapter、AgentManager bridge、usage ledger、持久化 schema、tests 与 docs，风险显著更大。

### 方案 C：方案 A 加自动 transcript 历史回填

- **做什么**：完成方案 A 后，再扫描 Codex transcript，通过 agent session/native handle 重建历史 contribution 并重写 ledger。
- **优点**：保留 transcript 且映射成功的历史可得到修正，修复部署后 Status bar 不必从低基线重新累积。
- **缺点 / 风险**：已删除 transcript、非 Paseo thread、跨日基线、模型切换、child thread 和既有正确 records 都会造成不完整或重复；这是数据迁移/运维能力，不是小范围 bug fix，且需要两台 Host 分别授权执行。
- **影响面**：新增重建工具或迁移、ledger 重写策略、备份/回滚与跨 Host 运维流程。

### 推荐方案

**推荐方案 A**。它直接修正 provider adapter 与 ledger 的 contract mismatch，生产改动集中、可用纯单元测试锁定，而且不会为了追平网关而误计非 Paseo 历史。既有历史保持原样并在 fix-note 明确记录；如确需回填，应将方案 C 作为单独、显式授权的数据修复任务。

验证范围：目标 Codex adapter 测试、usage ledger 测试、AgentManager usage bridge 测试、现有多 Host view-model 测试，以及仓库要求的 typecheck、lint、format。不会运行全量测试，也不会重启 6767 daemon。
