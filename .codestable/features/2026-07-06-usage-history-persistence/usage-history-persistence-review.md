---
doc_type: feature-review
feature: 2026-07-06-usage-history-persistence
status: passed
reviewer: subagent+ocr
reviewed: 2026-07-06
round: 1
---

# usage-history-persistence 代码审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-design.md`
- Checklist: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-checklist.yaml`
- Evidence pack: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-evidence-pack.md`
- Gate results: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-scope-gate.json`
- DoD results: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-dod-results.json`
- Implementation evidence: 当前工作区 diff、DoD runner fresh evidence、独立 reviewer 输出。
- Diff basis: `git status --short` + `git diff --stat`，本轮实现文件为 daemon usage ledger、AgentManager bridge、bootstrap 初始化、data model 文档和 feature 产物。
- Baseline dirty files: `.codestable/` goal/design/gate runtime 本身是本 roadmap goal 包的一部分；本 review 只审 usage-history-persistence 允许路径。

### Independent Review

- Detection: Paseo MCP 可用，按 `~/.paseo/orchestration-preferences.json` 使用 audit provider `claude/opus` 创建独立 subagent；OCR CLI 可用并已完成。
- 环节 A 独立隔离 Task agent: `paseo` + `completed`，agent `1d9d2d89-a20b-46e2-902f-f6c3f8aed815`，只读 review，无 blocking。
- 环节 B OCR CLI: `completed`。OCR 扫描命中大量 `.codestable/tools` findings，按 independent-review protocol 丢弃；唯一实现相关 finding 是 fallback usage turn key 的 straggler/terminal 时序风险，已本地核验并并入 QA focus。
- OCR severity mapping: High->blocking/important, Medium->nit/suggestion, Low->discarded；所有 OCR finding 都逐条按 scope 和仓库事实核验后合并或丢弃。
- Merge policy: subagent findings 已本地核验；I2 的确定测试缺口已在本轮补测并重跑 DoD；I1 和写路径成本不阻塞本 feature，作为 residual risk / QA focus 保留。
- Gate effect: `reviewer: subagent+ocr` 满足 review gate 放行锚点。

## 2. Diff Summary

- 新增：
  - `packages/server/src/server/usage-ledger/index.ts`
  - `packages/server/src/server/usage-ledger/usage-ledger.test.ts`
  - `.codestable/features/2026-07-06-usage-history-persistence/*-dod-results.json`
  - `.codestable/features/2026-07-06-usage-history-persistence/*-evidence-pack.*`
  - `.codestable/features/2026-07-06-usage-history-persistence/*-scope-gate.json`
- 修改：
  - `packages/server/src/server/agent/agent-manager.ts`
  - `packages/server/src/server/agent/agent-manager.test.ts`
  - `packages/server/src/server/bootstrap.ts`
  - `docs/data-model.md`
  - `.codestable/roadmap/global-status-bar/goal-state.yaml`
  - feature checklist / design formatting artifacts
- 删除：none
- 未跟踪 / staged：`.codestable/` goal 包和 `packages/server/src/server/usage-ledger/` 尚未提交；无 staged diff。
- 风险热点：持久化文件格式、异步非阻塞写队列、turn boundary / usage dedupe、daemon bootstrap 顺序。

## 3. Adversarial Pass

- 假设的生产 bug：provider 未来在 `usage_updated` 携带与 `turn_completed` 不同语义的 `turnId`，导致同一 turn usage 被拆成两个 basis 并重复累计。
- 主动攻击过的反例：缺 event turnId、多 turn reset、同快照跨事件、stale 回退、context window 不累计、corrupt file、daemon reload、archived/delete agent、terminal 后 fallback 清理、bootstrap initialize 顺序。
- 结果：缺 active foreground turn 时的 generated fallback key 测试缺口已修复；turnId 语义不一致、straggler usage、写路径放大和 hard-delete ledger 清理作为 QA focus / residual risk 记录，不阻塞当前 design。

## 4. Findings

### blocking

- none

### important

- none

### nit

- [ ] REV-001 `packages/server/src/server/usage-ledger/index.ts` 首次出现的新 contribution 字段值为 `0` 时会落一条零贡献 record。
  - Evidence: subagent review 指出 `previousValue === undefined` 时直接写 `delta[field] = nextValue`，`hasContribution` 只检查 `!== undefined`。
  - Impact: totals 不受影响，主要是文件清洁度和少量无效记录；不影响 design 成功标准。

- [ ] REV-002 `packages/server/src/server/usage-ledger/index.ts` record id 去重命中时更新内存 basis 但不持久化。
  - Evidence: 去重分支 `basesByKey.set(...); return` 不调用 `persistAgent`。
  - Impact: 正常流程里同 basis 相同 canonical snapshot 不会产生正向 delta，实际影响很低；保留为后续清理点。

### suggestion

- [ ] REV-003 可在后续 status summary 压测前把 ledger 去重从 `records.some` 改为 per-agent/per-basis `Set<recordId>`，减少长寿命 agent 写路径扫描成本。
- [ ] REV-004 未来新增 provider 时，明确 `usage_updated.turnId` 是否可信；如果 provider 的中间 usage id 不是 turn id，应在 bridge 层统一用 active foreground turn 或 provider adapter 给出的正式 turn boundary。

### learning

- Usage ledger 的 turn boundary 不只是存储问题，也是 provider adapter contract；新增 provider 时必须同时审查 usage snapshot 是否 turn-scoped、是否单调、事件 turnId 是否等价于 Paseo foreground turn。

### praise

- `usage_updated` 与 `turn_completed` 复用 `enqueueUsageLedgerEvent`，AgentManager 没有承载 ledger 差分逻辑，模块边界干净。
- record identity 只基于 contribution fields 的 canonical snapshot，context window 保留在 raw usage 但不累计，测试覆盖清楚。
- file-backed ledger 解析失败只记录并跳过，避免损坏单 agent usage 文件阻断 daemon 启动或 agent lifecycle。
- `enqueueEvent` 串行队列和热路径 `void` 调用保持了非阻塞 stream dispatch。

## 5. Test And QA Focus

- QA 必须重点复核：
  - `npx vitest run packages/server/src/server/usage-ledger/usage-ledger.test.ts --bail=1`
  - `npx vitest run packages/server/src/server/agent/agent-manager.test.ts --bail=1 -t "usage ledger"`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run format:check`
- 已补强测试：subagent I2 指出的 generated fallback `usage-turn-N` 分支已新增覆盖，`agent-manager.test.ts` 现在证明无 active foreground turn 且事件无 turnId 时，两轮 usage 使用 `usage-turn-1` / `usage-turn-2`。
- Evidence pack residual risks / gate warnings：evidence pack residual risk 为 none；provider warning 已解释为 archguard 可用但未收集风险摘要、meta-cc 不可用，这两项不隐藏核心 evidence。
- 建议 QA 重点复核：
  - `usage_updated.turnId` 与 `turn_completed.turnId` 不一致时的当前行为是否作为后续 provider contract 风险记录。
  - terminal 后 late `usage_updated` 的 straggler 场景是否可能在 first-party provider 出现。
  - 任一字段回退导致整份 event stale 的语义是否与真实 Codex/Claude cost/token 单调性相容。
  - archive 不删 ledger、hard-delete 仅有 `deleteAgentUsage` 入口但未接线的产品边界是否记录为知情残余。
  - coalescer 只影响 stream dispatch，不应吞掉最后一份可累计 usage snapshot。
- 建议新增或加强的测试：本轮已补 generated fallback branch；turnId 不一致和 straggler usage 建议作为后续 provider compatibility / hardening 测试，不要求本 feature 阻塞。
- 不能靠 review 完全确认的点：真实 provider 是否会发送不一致 turnId 或 terminal 后 late usage，需要 QA/后续集成观察。

## 6. Residual Risk

- Provider turnId 语义风险：当前 bridge 信任 `event.turnId ?? activeForegroundTurnId`。现有 first-party provider 路径满足 design，但未来 provider 若把 `usage_updated.turnId` 用作 message/sub-turn id，可能拆 basis 并双计。后续 provider feature 应显式测试。
- 写路径扩展性风险：单 agent ledger 目前每个正向 record 都做线性去重和整文件原子重写。status bar v1 可接受，长寿命 agent 压测或 rollup feature 可再优化。
- Hard-delete 清理边界：archive 保留 ledger 符合 design；hard-delete 目前没有接 `deleteAgentUsage`，孤儿 ledger 是否继续计入 lifetime 需后续产品决策。

## 7. Verdict

- Status: passed
- Next: 进入 `cs-feat` QA 阶段，按 review QA focus 和 evidence pack 复核核心路径。
