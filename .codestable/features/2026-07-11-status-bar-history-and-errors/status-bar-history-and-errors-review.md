---
doc_type: feature-review
feature: 2026-07-11-status-bar-history-and-errors
status: passed
reviewer: subagent
reviewed: 2026-07-11
round: 2
---

# status-bar-history-and-errors 代码审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-design.md`
- Checklist: `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-checklist.yaml`
- Evidence pack: `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-evidence-pack.md`
- Gate results: `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-scope-gate.json`
- DoD results: `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-dod-results.json`
- Implementation evidence: `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-implementation.md`
- Diff basis: 当前 unstaged diff；`git diff --cached` 为空。
- Baseline dirty files: `.codestable/reference/*`、`.codestable/runtime-manifest.json`、`.codestable/reference/solution-depth-conventions.md` 为本轮前已存在的 unrelated dirty，未纳入本 feature review findings。

### Independent Review

- Detection: Paseo MCP provider discovery/create calls被拒绝；当前宿主可见原生 sub-agent 可用；`ocr` CLI 可用且 `ocr llm test` 通过。
- 环节 A 独立隔离 Task agent: `native-agent` completed。
  - Round 1 agent: `019f4f06-430c-78b1-a625-265ef312ee21`，verdict `passed`，提出 filtered-only history 空态测试建议。
  - Round 2 agent: `019f4f0b-c545-7c32-82fd-32bb08c43834`，verdict `passed`，无 blocking / important / nit / suggestion。
- 环节 B OCR CLI: `skipped-scope-ambiguous`。当前 workspace 有 unrelated dirty/untracked CodeStable reference 文件；`ocr review` 不能按文件列表限制未提交 diff，裸跑会越界扫描。
- OCR severity mapping: High -> blocking/important, Medium -> nit/suggestion, Low -> discarded；本轮无 OCR finding。
- Merge policy: sub-agent findings 已逐条本地核验；Round 1 suggestion 已补测试并刷新 gates；Round 2 无阻塞项。
- Gate effect: `reviewer: subagent`，code review gate 放行。

## 2. Diff Summary

- 新增：
  - `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-implementation.md`
  - `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-review.md`
- 修改：
  - `packages/app/src/status-summary/status-bar-running-sessions.tsx`
  - `packages/app/src/status-summary/global-status-bar.tsx`
  - `packages/app/src/status-summary/status-bar-running-sessions.test.tsx`
  - `packages/app/src/status-summary/global-status-bar.test.tsx`
  - `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-checklist.yaml`
  - `.codestable/features/2026-07-11-status-bar-history-and-errors/goal-state.yaml`
  - `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-scope-gate.json`
  - `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-dod-results.json`
  - `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-evidence-pack.md`
  - `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-evidence-pack.json`
- 删除：none。
- 未跟踪 / staged：feature 目录为未跟踪流程产物；staged diff 为空。
- 风险热点：用户可见 UI；静态/交互边界；history 过滤顺序。

## 3. Adversarial Pass

- 假设的生产 bug：空闲状态表面不可交互，但仍挂载 open state / route effect / overlay，导致可打开空 panel 或状态栏形状抖动。
- 主动攻击过的反例：
  - 无 running / attention / recent snapshots：`StatusBarRunningSessionsTrigger` 顶层直接返回 `SessionStatusStaticView`，不进入 `InteractiveRunningSessionsTrigger`。
  - history 最新项是 `closed` 或带有效 `paseo.parent-agent-id`：先 filter 再 slice，过滤项不占十条上限。
  - history 全部被过滤：filtered-only empty state 测试覆盖，显示既有 empty state。
  - active desktop / compact：既有 dropdown、sheet、agent/workspace navigation、pin、history refresh 测试继续通过。
- 结果：无 blocking / important finding；真实设备视觉/可访问性触感留给 QA focus。

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

- `packages/app/src/status-summary/status-bar-running-sessions.tsx:142` 将空闲/活跃边界放在 selector 顶层，只有 active 分支进入 `InteractiveRunningSessionsTrigger`，这是避免空闲路径创建 open state、route effect、DropdownMenu/sheet 的关键边界。

### praise

- `packages/app/src/status-summary/status-bar-running-sessions.tsx:334` 使用 `agents.filter(isStatusBarHistoryVisible).slice(0, HISTORY_LIMIT)`，顺序符合“先过滤再截断”。
- `packages/app/src/status-summary/status-bar-running-sessions.test.tsx` 覆盖补位和 filtered-only 空态，Round 1 reviewer 指出的测试缺口已关闭。
- `packages/app/src/status-summary/global-status-bar.tsx:93` 无条件移除 running/attention primary chips，`packages/app/src/status-summary/global-status-bar.tsx:107` 无条件挂载 sessions 区域，贴合 approved design。

## 5. Test And QA Focus

- QA 必须重点复核：空闲 ready status bar 显示会话状态静态视图和 running 0，没有独立 running/attention chips，点击不会打开空 sessions panel/sheet。
- QA 必须重点复核：history 中 `closed` 或带有效 `paseo.parent-agent-id` 的条目不展示，后续 root agent 能补足 10 条。
- QA 必须重点复核：desktop dropdown、compact sheet、session navigation、pin controls、history refresh 没回归。
- Evidence pack residual risks / gate warnings：`mise` android-sdk cache/network warning 出现在 stderr，但 CMD-001 至 CMD-004 均 exit 0。
- 建议新增或加强的测试：none for this feature。parent label 空白/非字符串边界已由 protocol helper 覆盖，可作为未来集成层增强。
- 不能靠 review 完全确认的点：真实 RN native accessibility tree 和触摸反馈需 QA / acceptance 手动复核。

## 6. Residual Risk

- 当前仓库有 unrelated `.codestable/reference/*` dirty 文件；本 review 未归因也未修改。
- 没有启动真实浏览器或移动设备做视觉/触摸验证；QA 阶段需补产品行为复核。

## 7. Verdict

- Status: passed
- Next: 进入 `cs-feat` QA 阶段。
