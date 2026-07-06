---
doc_type: feature-acceptance
feature: 2026-07-06-usage-history-persistence
status: passed
accepted: 2026-07-06
round: 1
---

# usage-history-persistence 验收报告

> 阶段：阶段 3（验收闭环）
> 验收日期：2026-07-06
> 关联方案 doc：`.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-design.md`

## 1. 接口契约核对

**接口示例逐项核对**：

- [x] `UsageLedger` deep module：对外接口为 `initialize`、`enqueueEvent`、`getTotals`、`getTodayTotals`、`flush`、`deleteAgentUsage`。
  - 代码实际行为：`packages/server/src/server/usage-ledger/index.ts` 只暴露 ledger API 和 file-backed implementation；调用方不处理 provider 差分语义。
- [x] AgentManager bridge 输入：`usage_updated` / `turn_completed` 构造成 `UsageLedgerEventInput`。
  - 代码实际行为：`enqueueUsageLedgerEvent` 传入 agent/provider/session/workspace/cwd/model/turn metadata、source event、usage 和 observedAt；热路径不 await I/O。
- [x] 查询契约：`getTotals({})` 返回 lifetime totals，`getTodayTotals(now)` 使用 daemon local day。
  - 代码实际行为：目标测试覆盖空 totals、lifetime、today window、reload 后 totals。

**名词层“现状 → 变化”逐项核对**：

- [x] `AgentUsage` 继续复用既有 shape；未引入第二套 token 字段名。
- [x] Usage contribution 只包含 `inputTokens`、`cachedInputTokens`、`outputTokens`、`totalCostUsd`。
- [x] Usage ledger 独立于 agent record 和 timeline，新增 `$PASEO_HOME/usage-ledger/{agentId}.json`。
- [x] Snapshot basis / Usage turn key / Basis scope 均为 ledger 内部事实，不暴露到 status summary 协议。

**流程图核对**：

- [x] provider stream event -> AgentManager usage bridge -> UsageLedger normalize -> dedupe/stale/drop/record -> atomic persist -> totals query 都有代码落点。

## 2. 行为与决策核对

**需求摘要逐项验证**：

- [x] 同一 agent usage 事件重复到达不会重复累计：`usage-ledger.test.ts` 同快照跨事件去重通过。
- [x] provider 只给累计快照时可用 snapshot basis 算 delta：positive delta / stale 回退测试通过。
- [x] daemon 重启后重新加载 `$PASEO_HOME` totals 不变：reload 测试通过。
- [x] archived agent 历史 contribution 保留并参与 totals：delete/archived test 证明不删除 archived contribution。

**明确不做逐项核对**：

- [x] 未实现 `status.summary.*` RPC 或 `server_info.features.statusSummary`。
- [x] 未改 app UI、Expo route、status bar component。
- [x] 未调用 `provider.usage.list` 或 quota fetcher。
- [x] 未改变 archive cascade、tab close 或 lifecycle state transition 语义；AgentManager bridge test 覆盖 turn completion 后 lifecycle idle。
- [x] totals 不累计 `contextWindowMaxTokens` / `contextWindowUsedTokens`。

**关键决策落地**：

- [x] 新增 `usage-ledger` daemon module，而不是扩展 `StoredAgentRecord`。
- [x] ledger 记录 delta，另存 snapshot basis。
- [x] today 窗口由 daemon 本地日历日决定。
- [x] AgentManager 只做事件桥接。

**编排层“现状 → 变化”逐项核对**：

- [x] `usage_updated` 保持 `agent.lastUsage` 更新，并额外 enqueue ledger event。
- [x] `turn_completed` 仅在 `event.usage` 存在时 enqueue ledger event。
- [x] history replay 不写 ledger。
- [x] ledger 查询不依赖 live agents。

**流程级约束核对**：

- [x] 写入失败不打断 stream dispatch：`enqueueEvent` 捕获并记录 error。
- [x] basisKey 不包含 `sourceEventType`，同 basis 相同 snapshot 不重复累计。
- [x] stale 回退不写负 contribution，不向下刷新 basis。
- [x] production 使用 daemon clock，测试可注入 fixed `observedAt` / `now`。
- [x] invalid/corrupt/stale/persist failure 有日志路径，不输出 prompt 或 transcript。

**挂载点反向核对（可卸载性）**：

- [x] `$PASEO_HOME/usage-ledger/{agentId}.json`：`FileBackedUsageLedger` 使用 `path.join(paseoHome, "usage-ledger")`。
- [x] `packages/server/src/server/usage-ledger/`：新增 deep module 和 tests。
- [x] `packages/server/src/server/bootstrap.ts`：初始化 `FileBackedUsageLedger` 并注入 `AgentManager`。
- [x] `packages/server/src/server/agent/agent-manager.ts`：新增 non-blocking bridge。
- [x] `docs/data-model.md`：新增 Usage Ledger 持久化结构。
- [x] 反向 grep：`UsageLedger` / `usage-ledger` / `enqueueUsageLedgerEvent` 命中均落在挂载点或测试/文档内。
- [x] 拔除沙盘推演：删除 usage-ledger module、AgentManager injection/bridge、bootstrap 初始化、docs section 后可回到无 ledger 行为；archive 路径无额外清理耦合。

## 3. 验收场景核对

- [x] 连续收到同一 turn 的递增 usage 快照 -> lifetime/today 只累计正向增量。
  - 证据来源：`usage-ledger.test.ts`
  - 结果：通过。
- [x] Codex/OpenCode/Claude 实践中不带 event turnId 的连续 turn reset -> 依靠 activeForegroundTurnId 或 bridge sequence 分成不同 basis。
  - 证据来源：`agent-manager.test.ts` 两个 bridge tests；subagent review 后补充 generated fallback branch test。
  - 结果：通过。
- [x] ACP/Pi turn-scoped reset -> 每个 turn 独立计入，不被上一 turn stale 丢弃。
  - 证据来源：ledger per-provider/turn key fixture。
  - 结果：通过。
- [x] `turn_completed` 最终 usage 与同 basis 已处理 snapshot 相同 -> 不重复累计。
  - 证据来源：dedupe test。
  - 结果：通过。
- [x] daemon 写入 ledger 后重启 -> 新实例加载同样 totals。
  - 证据来源：persist/reload test。
  - 结果：通过。
- [x] 跨 daemon 本地日历日 -> today 只包含当前日窗口，lifetime 包含两天。
  - 证据来源：today/lifetime test。
  - 结果：通过。
- [x] archived agent 后不删除 ledger -> history 仍进入 totals。
  - 证据来源：delete/archived test + archive path diff review。
  - 结果：通过。
- [x] usage 字段部分缺失 -> totals 只包含出现过的数字字段。
  - 证据来源：ledger delta tests and contribution field implementation。
  - 结果：通过。
- [x] snapshot 回退或乱序 -> 不写负 contribution，也不降低 basis。
  - 证据来源：stale snapshot test。
  - 结果：通过。
- [x] ledger 文件损坏 -> log and skip，不阻塞 healthy data。
  - 证据来源：corrupt file test。
  - 结果：通过。
- [x] hard delete 有 `deleteAgentUsage` 清理入口；archive 不触发清理。
  - 证据来源：ledger API test + AgentManager grep。
  - 结果：通过。

**review 报告重点复核**：

- [x] Review Test And QA Focus 已由 QA 报告覆盖。
- [x] Review residual risk 均为未来 provider contract / scalability / hard-delete product decision，不承载核心验收缺口。

**QA 报告重点复核**：

- [x] 验证证据来源：`.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-qa.md`
- [x] QA matrix 覆盖 design 关键场景、DoD commands、review QA focus、evidence pack residual risks。
- [x] Feature type 为 functional，核心路径均有目标测试或 diff/manual 证据。
- [x] failed / blocked 项为 none。
- [x] residual-risk 没有承载核心验收缺口。
- [x] Evidence pack、DoD Results、Gate Results 均复核通过。

## 4. 术语一致性

- `UsageLedger` / `UsageLedgerRecord` / `UsageSnapshotBasis`：代码命名与 design 一致。
- `usageTurnKey` / `basisKey` / `basisScope: "turn"`：代码命名与 design 一致。
- `contribution`：只用于 token/cost delta，不混用 context window。
- 防冲突：未新增 `status.summary` / app status bar / provider quota 命名。

## 5. 领域影响盘点（提示而非代写）

- [x] 新名词 `Usage Ledger` / `Usage contribution` / `Usage turn key`：已写入 `docs/data-model.md`，后续若要统一长期领域模型，可走 `cs-domain` 将术语沉淀到 requirements context。
- [x] 结构性选择：usage history 独立于 agent record 和 timeline，新增 daemon deep module。这是有长期价值的架构决策，但当前设计和 data-model 文档已记录；是否追加 ADR 可由后续 cs-domain 处理。
- [x] 流程级约束：turn-scoped basis、non-blocking bridge、stale snapshot drop。已在 design/review/QA/acceptance 中记录；建议 status-summary-protocol feature 继续沿用。

## 6. requirement delta / clarification 回写

- Design frontmatter 没有 `requirement` 字段，roadmap `related_requirements` 为空。
- 本 feature 新增的是 roadmap 内部 daemon 数据源能力，不改用户可见 pitch / public requirement 文档。
- 结论：无 owner-approved req delta 需要机械应用；不在 acceptance 阶段自由回写 requirement。

## 7. roadmap 回写

- [x] design frontmatter `roadmap: global-status-bar`、`roadmap_item: usage-history-persistence` 均存在。
- [x] `.codestable/roadmap/global-status-bar/global-status-bar-items.yaml` 对应 item 已从 `in-progress` 改为 `done`。
- [x] `.codestable/roadmap/global-status-bar/global-status-bar-roadmap.md` 第 5 节对应条目已同步为 `状态：done`，`对应 feature：2026-07-06-usage-history-persistence`。
- [x] YAML 校验在最终审计命令中执行。

## 8. attention.md 候选盘点

- 本 feature 未暴露需要补入 `attention.md` 的通用环境/工具/工作流信息。
- 可复用知识候选：未来 provider 接入时必须确认 usage event turnId 是否等价于 Paseo turn boundary；适合后续 `cs-keep` 或 provider 文档沉淀，不需要当前阻塞。

## 9. 遗留

- 后续优化点：
  - future provider 若 `usage_updated.turnId` 不是 turn boundary，应在 provider adapter 或 bridge 层显式归一化。
  - 长寿命 agent ledger 写路径可在后续 rollup/indexing feature 优化。
  - hard-delete 是否清理 usage ledger 需要产品决策；archive 保留历史是本 feature 明确要求。
- 已知限制：
  - 第一版不做 daily/provider/model rollup 缓存。
  - 第一版不做 status summary RPC/UI/provider quota。
- 实现阶段顺手发现：none。

## 10. 最终审计

- 验证证据来源：`usage-history-persistence-qa.md`
- Evidence sources：`usage-history-persistence-evidence-pack.md` / `usage-history-persistence-dod-results.json` / `usage-history-persistence-scope-gate.json`
- 聚合命令：
  - `npx vitest run packages/server/src/server/usage-ledger/usage-ledger.test.ts --bail=1` -> exit 0，8 tests passed。
  - `npx vitest run packages/server/src/server/agent/agent-manager.test.ts --bail=1 -t "usage ledger"` -> exit 0，3 tests passed。
  - `npm run typecheck` -> exit 0。
  - `npm run lint` -> exit 0。
  - `npm run format:check` -> exit 0。
- 场景复核：re-verified 11 / trust-prior-verify 0。
- 交付物复核：代码 / schema / bootstrap / docs / roadmap 均已落盘；requirement 无需回写。
- 完整工作区复核：tracked diff 和 untracked feature artifacts 已纳入 scope gate；更广的 `.codestable/` runtime/roadmap package 是 goal baseline。
- diff 清洁度：通过；本 feature 代码路径无 debug output、TODO/FIXME/XXX、commented-out code 或 `.only`。
- 知识沉淀出口：无 attention.md 候选；provider turnId 语义可后续 `cs-keep` / provider docs 沉淀。
- 结论：通过。
