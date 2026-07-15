---
doc_type: issue-review
issue: 2026-07-15-codex-status-cost-undercount
status: passed
reviewer: subagent+ocr
reviewed: 2026-07-15
round: 2
lane_a_state: completed
lane_a_ref: "paseo:78051d7a-9103-4542-9a33-b160e9238e63"
lane_a_reason: "Claude/Opus provider 强制只读完整复审完成；无 blocking/important，工作区基线无 reviewer 写入"
lane_b_state: completed
lane_b_ref: "ocr:68990909-9447-47a0-afee-5386a7863b5c;isolated-commit:fcaf432cdb3412685699fc973b33e0ccf170aa2f"
lane_b_reason: "round 2 OCR 完成；两个 medium 经本地核验分别受官方必填字段 schema 约束、以及被 HEAD 旧实现证伪，均不升级为 blocking/important"
---

# codex-status-cost-undercount 代码审查报告

## Round 1 Result

- Lane A: `paseo:fb7b34ba-389a-46b8-b398-b50b817e0f3d`，Claude/Opus 强制只读，完成且基线无写入；外部 verdict 为 passed。
- Lane B: OCR session `f897f40e-be7e-44c9-8ecb-369c1c2bef74`，隔离 commit `694a019f0c6f1411d2e9ff74611ad4b7f3c29aac`，完成。
- 主审 finding `REV-001`：旧 guard 在 `currentTurnId === null` 时接受带旧 native turnId 的 usage。RED 用例观察到先错误发出 `20/8/2`，再把新 turn 的 `40/15/5` 压成 `20/7/3`。
- Review-fix：guard 改为携带 native turnId 时必须严格等于当前 native turnId；旧 payload 缺失 turnId 的兼容路径不变。修后目标用例、10 个 usage/turn-id 聚焦用例、typecheck 与 lint 均通过。
- Change class: Material。生产时序行为改变，因此不能 focused closure，进入 round 2 双环节完整复审。

## 1. Scope And Inputs

- Design: `.codestable/issues/2026-07-15-codex-status-cost-undercount/codex-status-cost-undercount-analysis.md`
- Checklist: `.codestable/issues/2026-07-15-codex-status-cost-undercount/codex-status-cost-undercount-fix-note.md`
- Evidence pack: 同目录 report、analysis、fix-note 与 round 1 RED/GREEN 证据
- Gate results: Codex usage/turn-id 聚焦测试、typecheck、lint 与两轮独立审查结果
- DoD results: provider 归一化、唯一 turn key、迟到通知隔离、测试和文档均完成
- Implementation evidence: 当前未提交目标 diff、fix-note、测试输出
- Diff basis: `git status --porcelain=v1 --untracked-files=all`、未暂存 diff、暂存 diff
- Review mode: full-rereview
- Baseline dirty files: Codex 修复与 CodeStable 流程文件归因于本 issue；Claude provider 两个文件及 `.codegraph/` 为既有无关改动，明确排除

### Independent Review

- Detection: Claude reviewer 与 Codex 调用方属于不同模型家族；`plan` 模式由 provider 强制禁止编辑；OCR CLI 可用
- 环节 A 独立隔离 Task agent: heterogeneous-agent + completed，`paseo:78051d7a-9103-4542-9a33-b160e9238e63`
- 环节 B OCR CLI: completed，session `68990909-9447-47a0-afee-5386a7863b5c`
- OCR severity mapping: High->blocking/important, Medium->nit/suggestion, Low->discarded
- Merge policy: 两个环节结果均逐条用当前源码、HEAD 旧实现和官方生成 schema 本地核验后合并
- Gate effect: none

首次 Claude/Fable reviewer `paseo:9190b5c0-3cff-42a6-98fb-180012fa0fe7` 因推理网关 `503 No available accounts` 未进入审查，不计入 completed reviewer。round 1 的 Claude/Opus reviewer 与 OCR 均完成；生产 guard 修复后按 Material change 增加 round 2 并重跑双环节，没有复用旧 gate。

## 2. Diff Summary

- 新增：issue report、analysis、fix-note、review 与 approval history
- 修改：Codex app-server adapter、对应测试与 `docs/data-model.md`
- 删除：none
- 未跟踪 / staged：issue 目录未跟踪；真实 staged diff 为空
- 风险热点：用量累计状态、native 通知时序、持久化 ledger basis key

## 3. Adversarial Pass

- 假设的生产 bug：新 foreground turn 已激活但 native turn 尚未建立时，旧 usage 改写 thread baseline，导致下一次 delta 少算或错归属
- 主动攻击过的反例：同 turn 多模型调用、重复 total、resume 首通知、native counter reset、turn 前后迟到通知、无 total/turnId 的旧 payload、child-thread routing、跨进程 turn key
- 结果：`REV-001` 在旧 guard 上稳定 RED，修复后 GREEN；其余反例未证伪方案 A

## 4. Findings

### blocking

none

### important

- [x] REV-001 `packages/server/src/server/agent/providers/codex-app-server-agent.ts:5519` native `currentTurnId` 尚为空时，旧 guard 接受带旧 turnId 的 usage 并污染 baseline
  - Evidence: RED 先错误发出 `20/8/2`，再把新 turn 的 `40/15/5` 压成 `20/7/3`
  - Impact: 会在窄时序窗口制造少算、错归属或重复 contribution
  - Closure: guard 改为只要 payload 携带 turnId 就必须严格等于当前 native turnId；round 2 双环节复审确认关闭

### nit

- [ ] REV-002 `packages/server/src/server/agent/providers/codex-app-server-agent.ts:5555` `buildAgentUsageForModel` 返回对象后再判断 `if (this.latestUsage)` 为冗余 guard；无行为风险，本 issue 不混入清理
- [ ] REV-003 `packages/server/src/server/agent/providers/codex-app-server-agent.ts:5516` completion 后到达的最后一条 usage 会被拒绝；正常协议顺序下风险低，记录为残余时序风险

### suggestion

- [ ] REV-004 `packages/server/src/server/agent/providers/codex-app-server-agent.ts:934` delta 对任一缺失字段整体 fallback 到 `last`；当前 Codex 0.144.1 生成协议要求三项字段全部存在，因此不升级为实际缺陷
- [ ] REV-005 `packages/server/src/server/agent/providers/codex-app-server-agent.ts:5552` `contextWindowUsedTokens` 是当前请求占用点位，而 token/cost 是 turn 累计；可在后续注释中强调不同语义
- [ ] REV-006 Claude/OpenCode provider 仍可能使用进程内 ordinal turn id；未证明存在相同 usage contract，超出本 Codex issue，建议另行诊断

### learning

- provider 原生 usage 的累计作用域必须在进入 ledger 前显式归一化；只看字段名而不核对作用域会把合法快照判成 stale
- 持久化 snapshot basis 的 key 不能使用仅在单进程内唯一的 ordinal

### praise

- 修复集中在 provider 边界，没有扩大 ledger schema、AgentManager bridge 或多 Host app 聚合
- RED 用例精确锁定 native turn 尚未建立的窗口，避免只覆盖常规通知顺序

## 5. Test And QA Focus

- QA 必须重点复核：部署后在两个 Host 上让单个 Codex foreground turn 产生多次模型调用，对比 mapped transcript、单 Host summary 与多 Host Status bar 总和
- Evidence pack residual risks / gate warnings：既有历史不回填；child-thread usage 不计入 root
- 建议新增或加强的测试：后续可补真实 AgentManager + ledger 的跨 daemon basis 集成测试，以及 child-thread 费用归属测试
- 不能靠 review 完全确认的点：生产 app-server 通知顺序、真实网关定价差异、既有 ledger 历史缺口

验证事实：

- Codex usage/turn-id 聚焦测试：10 passed / 92 skipped
- `REV-001` 目标用例：旧实现 RED，修复后 1 passed
- round 2 reviewer 聚焦复核：6 passed
- `npm run typecheck`：全部 workspace 通过
- `npm run lint`：0 warnings / 0 errors
- Codex provider 整文件曾在实现后 102/102 通过；本轮再次全跑只命中既有固定 500ms resume 子进程 race，失败用例单独运行通过

## 6. Residual Risk

- 修复前少记的 today/lifetime ledger 不自动恢复
- Codex 内建 child-thread usage 仍不归入 root agent ledger
- 会话最后一个 turn 若在 completion 后才发送末次 usage，可能漏记该末次增量
- 单个 Paseo foreground turn 内若异常出现多个 native turn，turn-start reset 可能造成少记；正常路径未观察到该序列
- Claude/OpenCode ordinal turn key 是否存在同类持久化碰撞尚未诊断

## 7. Verdict

- Status: passed
- Next: Owner 已批准 `ConfirmFixCompletion`；更新 `changes-by-me.md` 并执行 scoped commit/push

## 8. Focused Closure（无则写 none）

none。`REV-001` 修改了生产时序行为，已按 Material change 完成 round 2 双环节完整复审，而非 focused closure。
