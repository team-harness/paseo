---
doc_type: feature-design-review
feature: 2026-07-06-usage-history-persistence
status: passed
reviewed: 2026-07-06
round: 2
---

# usage-history-persistence feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-design.md`
- Checklist: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-checklist.yaml`
- Intent / brainstorm: none
- Roadmap: `.codestable/roadmap/global-status-bar/global-status-bar-roadmap.md`, `.codestable/roadmap/global-status-bar/global-status-bar-items.yaml`
- Related docs: `.codestable/attention.md`, `docs/data-model.md`, `docs/architecture.md`, `docs/agent-lifecycle.md`, `docs/providers.md`, `docs/testing.md`
- Code facts checked: `packages/protocol/src/agent-types.ts`, `packages/server/src/server/agent/agent-manager.ts`, `packages/server/src/server/agent/agent-storage.ts`, `packages/server/src/server/agent/agent-projections.ts`, `packages/server/src/server/atomic-file.ts`, `packages/server/src/server/agent/providers/codex-app-server-agent.test.ts`, `packages/server/src/server/agent/providers/codex-app-server-agent.ts`, `packages/server/src/server/agent/providers/claude/agent.ts`, `packages/server/src/server/agent/providers/claude/agent.test.ts`, `packages/server/src/server/bootstrap.ts`

### Independent Review

- Status: completed
- Detection: paseo
- Provider / agent: `providers.audit = claude/opus`; first reviewer `43ff5af8-263a-4c05-81f6-6a8fd8b539ab`; second reviewer `6e5c019e-0742-4a34-a84f-281da88f7702`
- Raw output: first reviewer raised basisKey / negative delta / per-provider fixture issues; second reviewer raised turn boundary / non-blocking bridge / target-test issues. Both rounds were merged and design/checklist were revised.
- Merge policy: 已逐条核验并合并；旧 findings 中关于 `sourceEventType` 的问题已由最新版 design 的 turn-level basis 和 canonical snapshot 规则覆盖。
- Gate effect: none

## 2. Design Summary

- Goal: 为全局状态栏 epic 的第一段最小闭环建立 daemon 侧 usage ledger，支撑 persisted lifetime/today usage totals。
- Key contracts: `UsageLedger` deep module 负责 usage event 去重、turn-level snapshot basis、positive delta、文件持久化和窗口查询；`AgentManager` 只做事件 bridge。
- Steps: 6 步，按名词骨架、delta、持久化、AgentManager bridge、查询覆盖、文档验证推进。
- Checks: 11 条，覆盖名词契约、编排约束、挂载点、结构健康度、范围守护和 roadmap 核心场景。
- Baseline / validation: 目标 ledger 单测、目标 agent-manager 测试、`npm run typecheck`、`npm run lint`、`npm run format:check`。

## 3. Findings

### blocking

none

### important

- [x] FDR-001 `usage-history-persistence-design.md#2.1/#2.2` 第一轮 reviewer 指出 basisKey / negative delta / per-provider fixture / hard delete 语义缺口，已修订
  - Evidence: 第一轮 reviewer 提出 B1/B2/I1/I4；design 现已新增 `basisScope`、provider basisKey 表、negative delta/stale 判据、per-provider fixture 验收、`deleteAgentUsage` 清理入口。
  - Impact: 这些原本会阻塞实现正确性；第二轮 reviewer 已复核最新版，主 agent 合并后判定 resolved。

- [x] FDR-002 `usage-history-persistence-design.md#2.1/#2.2/#3.3` 第二轮 reviewer 指出 Codex/Claude events 不带 turnId 且 usage 为 turn-scoped 快照，已修订为 bridge-derived `usageTurnKey`
  - Evidence: design 现写明 Codex/Claude usage events 常不携带 `turnId`；basis scope v1 只允许 `turn`；`usageTurnKey` 来源为 `event.turnId ?? eventTurnId ?? agent.activeForegroundTurnId`，否则使用 bridge 维护的 per-agent sequence；移除 session-level fallback。
  - Impact: 修复前多 turn Codex/Claude 会丢数或错算；修复后实现必须用目标测试覆盖缺 event turnId 的多 turn fixture。

- [x] FDR-003 `usage-history-persistence-design.md#2.2` bridge 不能在 stream dispatch 热路径 await ledger I/O，已改为非阻塞 enqueue
  - Evidence: design 现把接口改为 `usageLedger.enqueueEvent(...)`，并声明不得在 `dispatchStreamEventByType` await 文件 I/O；ledger 内部串行队列和 try/catch 负责写入。
  - Impact: 降低 AgentManager bridge 侵入性，符合“写入失败不得打断 lifecycle/stream dispatch”的约束。

- [x] FDR-004 `usage-history-persistence-design.md#3.4 / checklist.dod` agent-manager 验证命令过宽，已收窄
  - Evidence: CMD-002 现为 `npx vitest run packages/server/src/server/agent/agent-manager.test.ts --bail=1 -t "usage ledger"`。
  - Impact: 符合仓库“不跑重套件”的测试约束。

### nit

- [x] FDR-005 `usage-history-persistence-design.md#2.3` 挂载点二选一表述已收敛
  - Evidence: design 现固定新增 `packages/server/src/server/usage-ledger/`，并在 `packages/server/src/server/bootstrap.ts` 初始化注入。

- [x] FDR-006 `usage-history-persistence-design.md#2.1` canonical snapshot 规则已补
  - Evidence: design 现规定 record id 使用固定字段顺序 `inputTokens/cachedInputTokens/outputTokens/totalCostUsd`，仅包含 finite number，context window 不参与 id。

### suggestion

- [ ] FDR-007 `usage-history-persistence-design.md#2.1` 实现阶段可把 `usageTurnKey` / `basisKey` 生成规则写成单独 helper
  - Evidence: design 已要求 `usageTurnKey` 来源优先级和 per-agent sequence fallback；部分 provider 的 usage event 可能缺 `turnId`。
  - Impact: 这不是 design 阻塞项，但实现若把 fallback 写散，会让去重语义难审。

### learning

- Codex 当前会先发 `usage_updated`，再在 `turn_completed` 中携带同一 `latestUsage`；ledger 必须跨 event type 共用 turn-level basis，不能按 `sourceEventType` 分账。

### praise

- design 明确把 usage ledger 从 `StoredAgentRecord` 和 timeline 中拆出来，符合 docs/data-model 的 file-backed store 模式，也避免 agent metadata store 被高频 usage 写入污染。
- checklist 的核心场景直接覆盖 roadmap item 要求的跨天、daemon 重启、archived agent 三件事。

## 4. User Review Focus

- 用户需要重点拍板：当前 feature 只做实际 agent usage ledger，不做 UI、不做 status summary RPC、不做 provider quota。
- implement 需要重点遵守：`usage_updated` 和同 turn `turn_completed` 的同快照不能重复累计；context window 字段只保留为 snapshot 信息，不进入 lifetime/today totals。
- code review / QA / acceptance 需要重点复核：负 delta/reset、无 `turnId` fallback、坏文件 parse、AgentManager bridge 是否吞掉 ledger 写入失败并保持 lifecycle。

## 5. Evidence Confidence Ledger

| Check                         | Verdict | Evidence Class | Basis                                                                                                                      | Follow-up |
| ----------------------------- | ------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- | --------- |
| Acceptance Coverage Matrix    | pass    | E              | design 3.3 覆盖 per-provider turn boundary、幂等、重启、跨天、archived、hard delete、bridge、文档和反向不做项              | none      |
| DoD Contract                  | pass    | E              | design 3.4 与 checklist `dod.commands` 均列出 core commands 和失败处理；agent-manager 命令已收窄 `-t "usage ledger"`       | none      |
| Steps and checks traceability | pass    | E              | checklist 6 steps / 11 checks 均能追溯到 design 1-3 节                                                                     | none      |
| Roadmap contract compliance   | pass    | E/C            | roadmap item 要求跨天、重启、archived；roadmap 风险要求 provider semantics fixture；design 3.1/3.3 与 checklist check 覆盖 | none      |
| Module interface design       | pass    | E/C            | design 2.1 含 `UsageLedger` interface、`usageTurnKey`/basis rules、seam、store/clock port、dependency strategy             | none      |
| Validation and artifacts      | pass    | E              | design/checklist 列出目标测试、typecheck、lint、format、docs/data-model 更新                                               | none      |

Summary: E=5, C=1, H=0, H-only core checks=none。

## 6. Residual Risk

- `usageTurnKey` 依赖 AgentManager bridge 时序：`turn_completed` 处理时 `activeForegroundTurnId` 尚未清空。design 已要求目标测试锁住该前提，code review 仍需重点看。
- 若未来 provider 出现 session-cumulative cost + turn-scoped token，当前 turn-scoped basis 需要扩展；design 已把这列为关键假设。

## 7. Verdict

- Status: passed
- Next: 在 epic child batch 中保持 design `draft`，返回 `cs-epic` 继续下一个 child feature design。
