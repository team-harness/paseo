---
doc_type: feature-qa
feature: 2026-07-06-usage-history-persistence
status: passed
tested: 2026-07-06
round: 1
---

# usage-history-persistence QA 报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-design.md`
- Checklist: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-checklist.yaml`
- Review: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-review.md`
- Evidence pack: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-evidence-pack.md`
- Gate results: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-scope-gate.json`
- DoD results: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-dod-results.json`
- Diff basis: `git status --short` shows modified implementation/docs and untracked CodeStable goal package; no staged diff.
- Baseline dirty files: `.codestable/` runtime/roadmap/design package is goal baseline. QA verdict covers this feature's implementation paths and feature artifacts only.
- Feature type: functional
- Core evidence gate: daemon usage ledger persistence/dedupe/query behavior, AgentManager live usage bridge behavior, bootstrap initialization, data model documentation consistency.

## 2. Verification Matrix

| ID     | 来源                        | 核心性          | 场景 / 风险                                                                               | 证据类型              | 命令或动作                                                                                         | 期望                                                              | 结果 |
| ------ | --------------------------- | --------------- | ----------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---- |
| QA-001 | design success              | core-functional | 空 ledger 与 lifetime/today totals                                                        | unit                  | `npx vitest run packages/server/src/server/usage-ledger/usage-ledger.test.ts --bail=1`             | 新 ledger 返回空 totals                                           | pass |
| QA-002 | design turn/dedupe          | core-functional | 同 turn positive delta、`usage_updated`/`turn_completed` 同快照去重                       | unit                  | 同 QA-001                                                                                          | lifetime totals 只累计正向 delta                                  | pass |
| QA-003 | design turn reset           | core-functional | 多 provider / 多 turn reset 不被判 stale                                                  | unit                  | 同 QA-001                                                                                          | turn keys 隔离 reset snapshot                                     | pass |
| QA-004 | design stale                | core-functional | 同 turn snapshot 回退/乱序不写负 contribution 且不降低 basis                              | unit                  | 同 QA-001                                                                                          | stale snapshot 被丢弃，后续正向 snapshot 仍正确                   | pass |
| QA-005 | design persistence          | core-functional | `$PASEO_HOME/usage-ledger/{agentId}.json` 持久化、Zod load、daemon restart 后 totals 保持 | unit                  | 同 QA-001                                                                                          | reload 后 totals 与写入前一致                                     | pass |
| QA-006 | design context window       | core-functional | context window 保留 raw usage 但不进 contribution / record identity                       | unit                  | 同 QA-001                                                                                          | persisted raw usage 有 context 字段，contribution 无 context 字段 | pass |
| QA-007 | design today/archive/delete | core-functional | daemon local day today totals、archived 保留、deleteAgentUsage 可清理                     | unit                  | 同 QA-001                                                                                          | today/lifetime/delete 行为符合 design                             | pass |
| QA-008 | bridge foreground basis     | core-functional | `usage_updated` 与 `turn_completed` 共用 foreground turn basis                            | integration unit      | `npx vitest run packages/server/src/server/agent/agent-manager.test.ts --bail=1 -t "usage ledger"` | 两类事件 usageTurnKey 相同且 lifecycle 回 idle                    | pass |
| QA-009 | review I2                   | core-functional | 无 active foreground turn 且 event 无 turnId 时使用 generated fallback sequence           | integration unit      | 同 QA-008                                                                                          | 两轮事件得到 `usage-turn-1` / `usage-turn-2`                      | pass |
| QA-010 | review residual             | supporting      | `usage_updated.turnId` 与 terminal turnId 不一致、late straggler usage                    | diff/manual           | review residual + code inspection                                                                  | 作为 provider contract 风险记录，不阻塞 first-party design        | pass |
| QA-011 | repo command                | supporting      | 类型、lint、格式                                                                          | typecheck/lint/format | `npm run typecheck`; `npm run lint`; `npm run format:check`                                        | 全部 exit 0                                                       | pass |
| QA-012 | cleanliness                 | supporting      | debug output / TODO / FIXME / XXX / `.only`                                               | grep                  | `rg -n "console\\.log\|TODO\|FIXME\|XXX\|debugger\|\\.only\\(" ...`                                | 本 feature 代码路径无命中                                         | pass |

## 3. Command Results

- `npx vitest run packages/server/src/server/usage-ledger/usage-ledger.test.ts --bail=1` -> exit 0: 1 file passed, 8 tests passed.
- `npx vitest run packages/server/src/server/agent/agent-manager.test.ts --bail=1 -t "usage ledger"` -> exit 0: 1 file passed, 3 tests passed, 116 skipped by filter.
- `npm run typecheck` -> exit 0: all workspaces typechecked.
- `npm run lint` -> exit 0: oxlint found 0 warnings and 0 errors.
- `npm run format:check` -> exit 0: all matched files use correct format.
- `python3 .codestable/tools/codestable-scope-gate.py ...` -> exit 0: implementation.before_review scope gate passed for feature paths.
- `python3 .codestable/tools/codestable-dod-runner.py ...` -> exit 0: DoD runner passed all checklist commands.
- `CODESTABLE_ALLOW_MAIN_CHECKOUT_IMPLEMENTATION=1 python3 .codestable/tools/validate-implementation-review.py --json` -> exit 0: review evidence gate passed. Override is limited to this user-provided main-checkout goal execution; subagent reviewer evidence remained required and present.
- `rg -n "console\\.log|TODO|FIXME|XXX|debugger|\\.only\\(" packages/server/src/server/usage-ledger packages/server/src/server/agent/agent-manager.ts packages/server/src/server/agent/agent-manager.test.ts packages/server/src/server/bootstrap.ts docs/data-model.md` -> exit 1: no matches, expected for cleanliness scan.

## 4. Scenario Results

- [x] QA-001 empty totals: pass
  - Evidence: `usage-ledger.test.ts` empty ledger test returned `{}` for lifetime and today totals.
- [x] QA-002 dedupe / positive delta: pass
  - Evidence: target ledger test shows repeated final snapshot across event types totals `inputTokens: 18`, `outputTokens: 5` rather than double counting.
- [x] QA-003 turn reset and provider split: pass
  - Evidence: target ledger test isolates `claude` turn reset and `opencode` provider contribution.
- [x] QA-004 stale snapshot: pass
  - Evidence: target ledger test drops lower `inputTokens` snapshot and later positive snapshot totals correctly.
- [x] QA-005 persistence reload: pass
  - Evidence: target ledger test writes under temp `paseoHome`, constructs a new `FileBackedUsageLedger`, initializes it, and reads same totals.
- [x] QA-006 context window exclusion: pass
  - Evidence: persisted record keeps `usage.contextWindowUsedTokens`, while `contribution` does not contain that field.
- [x] QA-007 today/archive/delete: pass
  - Evidence: today totals use daemon local day; deleteAgentUsage removes only selected agent file while archived-agent history remains.
- [x] QA-008 AgentManager foreground bridge: pass
  - Evidence: target agent-manager test records `usage_updated` and `turn_completed` with same foreground turn key and leaves lifecycle idle.
- [x] QA-009 generated fallback branch: pass
  - Evidence: added target agent-manager test pushes no-turnId events outside foreground run and observes `usage-turn-1` / `usage-turn-2`.
- [x] QA-010 review residuals: pass
  - Evidence: review report records turnId semantic mismatch, late straggler, write path cost, and hard-delete cleanup as non-core residual risks for future provider/hardening decisions. Existing first-party design paths remain covered.
- [x] QA-011 repo validation: pass
  - Evidence: typecheck, lint, format:check all exit 0.
- [x] QA-012 cleanliness: pass
  - Evidence: grep found no debug output, TODO/FIXME/XXX, `debugger`, or `.only` in this feature's code/doc paths.

## 5. Findings

### failed

- none

### blocked

- none

### residual-risk

- Future provider `usage_updated.turnId` semantics may diverge from Paseo turn boundary; this is a provider contract / hardening risk, not a failure of current first-party paths.
- Late straggler `usage_updated` after terminal event could generate a new fallback key if a provider emits no turnId and events arrive out of order. No current first-party evidence shows this path; keep in QA focus for later provider integration.
- Ledger write path rewrites one agent file per accepted positive record and does linear record id scanning. Acceptable for v1 status summary data source; rollup/indexing can be a future scalability feature.
- Hard-delete does not currently call `deleteAgentUsage`; archive retention is required by design, hard-delete cleanup semantics are deferred product behavior.

## 6. Cleanliness

- Debug output: pass
- Temporary TODO/FIXME/XXX: pass
- Commented-out code: pass
- Unused imports / dead code from this feature: pass
- Out-of-scope files: pass for feature scope gate; broader `.codestable/` runtime package remains roadmap goal baseline.

## 7. Verdict

- Status: passed
- Next: `cs-feat` acceptance 阶段
