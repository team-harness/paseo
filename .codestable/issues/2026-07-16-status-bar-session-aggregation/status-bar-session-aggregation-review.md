---
doc_type: issue-review
issue: 2026-07-16-status-bar-session-aggregation
status: passed
reviewer: subagent
reviewed: 2026-07-16
round: 2
---

# Status Bar 会话聚合异常代码审查报告

## 1. Scope And Inputs

- Report: `.codestable/issues/2026-07-16-status-bar-session-aggregation/status-bar-session-aggregation-report.md`
- Analysis: `.codestable/issues/2026-07-16-status-bar-session-aggregation/status-bar-session-aggregation-analysis.md`
- Implementation evidence: `status-bar-session-aggregation-fix-note.md`、定向测试、typecheck、lint
- Diff basis: 当前 unstaged diff 与本 issue 未跟踪目录
- Baseline dirty files: `.codestable/reference/agent-conventions.md`，用户已有无关改动，已排除

### Independent Review

- Detection: Paseo subagent 可用；OCR CLI 因工作区存在范围外 dirty 文件无法安全限定本轮未提交 scope
- 环节 A 独立隔离 Task agent: `paseo` + `completed`；round 1 agent `3bcec355-8158-48ca-b626-d35f50176376`，round 2 agent `49960b0c-aa81-421e-a5db-4bd61f9b0028`，均为 Claude Opus plan mode
- 环节 B OCR CLI: `skipped-scope-ambiguous`
- OCR severity mapping: High→blocking/important，Medium→nit/suggestion，Low→discarded
- Merge policy: 独立 reviewer 输出已逐条用当前代码、本轮测试和既有数据流本地核验后合并
- Gate effect: none

## 2. Diff Summary

- 新增：本 issue 的 report、analysis、fix-note、review
- 修改：`global-status-bar.tsx`、`status-bar-running-sessions.tsx`、`status-bar-session-pins.tsx`、`status-bar-running-sessions.test.tsx`、`global-status-bar.test.tsx`
- 删除：none
- 未跟踪 / staged：issue 目录未跟踪；无 staged 改动
- 风险热点：多 Host UI 聚合、异步刷新、跨 Host 导航、历史列表渲染规模

## 3. Adversarial Pass

- 假设的生产 bug：多 Host 条目在刷新或导航时错误复用当前 Host 上下文
- 主动攻击过的反例：父子 agent 跨分组折叠、同 agent 重复、某 Host 无 client、跨 Host Pin、快速开合面板、历史条目增长、测试 mock 假阳性
- 结果：Host 归属已进入 Pin list item；badge 与列表同源；刷新从全局 Host runtime 取 client；未发现 correctness finding。快速反复开合的请求量和长历史渲染进入 residual risk。

## 4. Findings

### blocking

none

### important

none

### nit

- [ ] REV-001 `packages/app/src/status-summary/status-bar-session-pins.tsx:256` Pin 行 React key 已按 `serverId:agentId` 命名空间化，但 testID 仍只含 agentId；极低概率的跨 Host agentId 碰撞会让自动化定位歧义，不影响运行时渲染和导航。

### suggestion

- [ ] REV-002 `packages/app/src/status-summary/global-status-bar.tsx:125` 当前 Host Pin 局部变量现在只服务单 Host fallback，可在后续维护中考虑内联；本轮保留能让 fallback 语义更直观。

### learning

- badge 必须复用 `buildStatusBarSessionList` 的分组结果，才能继承“子 agent 关注状态提升到顶层会话”的既有语义。

### praise

- Pin 条目显式携带 `serverId`，从数据模型上保证跨 Host 导航不再依赖当前页面 Host。
- 打开刷新并行执行且用 `Promise.allSettled` 隔离单 Host 失败，不阻塞面板交互。

## 5. Test And QA Focus

- QA 必须重点复核：三个以上 Host 的父子会话计数；慢速/离线 Host 混连时打开面板；从非当前 Host Pin 导航；长历史滚动。
- Evidence pack residual risks / gate warnings：无 goal gate；请求频率和渲染规模交给桌面端 QA 观察。
- 建议新增或加强的测试：后续可覆盖同 agentId 跨 Host testID 歧义，以及无 client Host 被刷新逻辑跳过。
- 不能靠 review 完全确认的点：真实 DropdownMenu 在桌面端是否会对一次打开重复触发 `onOpenChange(true)`。

## 6. Residual Risk

- 每次从关闭状态打开会话面板会对每个相关 Host 发起一次 summary 请求。当前单次打开没有重复调用，属于显式用户动作触发；QA 观察快速开合时是否出现请求堆积或界面抖动。
- 历史移除 10 条 UI 上限后会渲染 `useAgentHistory` 当前已加载的全部可见记录；滚动容器有高度限制，但多 Host 大历史量下仍需观察首开渲染开销。

## 7. Verdict

- Status: passed
- Next: issue 修复 gate 已通过，可进入用户验收或提交收尾。
