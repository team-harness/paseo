---
doc_type: issue-review
issue: 2026-07-16-status-bar-permission-attention
status: passed
reviewer: subagent+ocr
reviewed: 2026-07-16
round: 2
---

# Status Bar 权限请求提醒代码审查报告

## 1. Scope And Inputs

- Design: none，按 issue fast-track 修复
- Checklist: none
- Evidence pack: 远端 daemon `0.1.107` 实时 inspect 与 daemon 日志取证
- Gate results: 两轮独立 Paseo reviewer 均通过；两轮 OCR 均为 0 finding
- DoD results: `.codestable/issues/2026-07-16-status-bar-permission-attention/status-bar-permission-attention-fix-note.md`
- Implementation evidence: 服务端 status summary 修复、定向回归测试及 fix-note
- Diff basis: `git diff`，2 个修改文件和 1 个新增 issue 目录
- Baseline dirty files: none

### Independent Review

- Detection: Paseo subagent 与 OCR CLI 均可用
- 环节 A 独立隔离 Task agent: paseo + completed；第二轮 reviewer `ce7754be-1b74-4725-9f70-ac0226208258`
- 环节 B OCR CLI: completed
- OCR severity mapping: High→blocking/important，Medium→nit/suggestion，Low→discarded
- Merge policy: 两轮 reviewer 与 OCR 结果已逐条本地核验后合并
- Gate effect: none

## 2. Diff Summary

- 新增：本 issue 的 fix-note 与 review 文档
- 修改：`status-summary-service.ts`、`status-summary-service.test.ts`
- 删除：none
- 未跟踪 / staged：issue 文档目录未跟踪；代码未 staged
- 风险热点：权限状态转换、跨 Host status summary、状态栏 UI 语义

## 3. Adversarial Pass

- 假设的生产 bug：权限状态虽进入 `needs_input`，但显示语义未随 pending permission 的出现和解除正确切换。
- 主动攻击过的反例：running + permission、finished/error + permission、多个 pending permission、permission 解除回退、delegated child、同一 snapshot 同时进入需关注与最近完成列表、协议兼容、测试 fixture 假阳性。
- 结果：核心状态转换成立；delegated child 暴露与 finished + live permission 的最近完成展示留作 QA focus，均为既有行为边界。

## 4. Findings

### blocking

none

### important

none

### nit

none

### suggestion

none

### learning

- pending permission 是 level-triggered 的实时态，不写入 edge-triggered 的 `agent.attention`；status summary 必须显式将它折叠为展示用的 `attentionReason: "permission"`。
- `deriveAgentStateBucket` 已把 permission 设为最高优先级，修复只需补齐展示 reason，不需要修改协议或 bucket 规则。

### praise

- 修复复用既有 `attentionReason` 协议字段和 UI 权限分支，改动面小且保持协议向后兼容。
- 回归测试覆盖 permission 覆盖 finished，以及清空 pending permission 后恢复 finished，锁住了最重要的双向状态转换。
- 测试 fixture 的 `pendingPermissions` 同步改为真实 `Map`，避免类型强转掩盖错误数据形状。

## 5. Test And QA Focus

- QA 必须重点复核：远端 Host 出现真实权限请求时，会话行显示盾牌和“等待权限”；批准或拒绝后恢复 running / finished，不残留盾牌。
- Evidence pack residual risks / gate warnings：确认 delegated child 权限是否应继续折叠到父级状态栏；确认 finished + live permission 同时存在时最近完成区块显示权限状态符合预期。
- 建议新增或加强的测试：后续可增加 delegated child 与 recently completed 双列表的 app 组合测试；本轮核心服务端状态转换已有覆盖。
- 不能靠 review 完全确认的点：真实远端 Host 的端到端 UI 时序，需要安装包含本修复的 daemon 后实测。

## 6. Residual Risk

- delegated child 的 pending permission 会继续进入 status summary；这是修复前已有的列表行为，本次只补齐盾牌语义。
- finished agent 若仍有 live pending permission，同一快照在最近完成区块也会优先显示 permission；该优先级与既有 state bucket 一致。
- buffered 权限解除依赖后续状态广播触发 summary 重算，建议真机确认解除后盾牌及时消失。

## 7. Verdict

- Status: passed
- Next: 进入 issue 验收/提交阶段
