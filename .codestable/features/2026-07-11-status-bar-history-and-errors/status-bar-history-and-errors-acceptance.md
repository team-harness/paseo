---
doc_type: feature-acceptance
feature: 2026-07-11-status-bar-history-and-errors
status: passed
accepted: 2026-07-11
round: 1
---

# Status bar 历史与会话状态 UI 验收报告

> 阶段：阶段 3（验收闭环）
> 验收日期：2026-07-11
> 关联方案 doc：`.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-design.md`

## 1. 接口契约核对

**接口示例逐项核对**

- [x] `isStatusBarHistoryVisible(agent)`：设计要求 history 可见会话为未关闭且无有效父 agent 标签。
  - 代码实际行为：`packages/app/src/status-summary/status-bar-running-sessions.tsx:484` 使用 `agent.status !== "closed" && getParentAgentIdFromLabels(agent.labels) === null`，一致。
- [x] `StatusBarRunningSessionsTrigger`：设计要求无会话时为静态 View，有会话时才挂载交互 trigger。
  - 代码实际行为：`packages/app/src/status-summary/status-bar-running-sessions.tsx:142` 顶层 selector 先判断 snapshots；`SessionStatusStaticView` 是 `View + TriggerContent`；`InteractiveRunningSessionsTrigger` 独占 open state / route effect / overlay，一致。
- [x] `StatusBarContent` ready 分支：设计要求 ready status bar 始终挂载会话状态入口，不回退 running/attention primary chips。
  - 代码实际行为：`packages/app/src/status-summary/global-status-bar.tsx:93` 永久过滤 running/attention rows；`global-status-bar.tsx:107` 无条件挂载 `StatusBarRunningSessionsTrigger`，一致。

**名词层“现状 → 变化”逐项核对**

- [x] 历史可见会话：由直接 `slice(0, 10)` 变为 `filter(...).slice(0, 10)`，一致。
- [x] 会话状态静态视图：空闲路径由 primary chips 变为 `status-bar-sessions-static`，一致。
- [x] 会话状态触发器：active 路径保留 existing dropdown/sheet/navigation/pins，目标测试通过，一致。

**流程图核对**

- [x] agent history -> filter -> slice：`StatusBarSessionHistoryTrigger` 中实际落点存在。
- [x] ready status bar -> sessions area -> static/interactive：`GlobalStatusBar` 与 `StatusBarRunningSessionsTrigger` 中实际落点存在。
- [x] interactive -> compact sheet / desktop dropdown -> list/navigation：既有代码保留，目标测试通过。

## 2. 行为与决策核对

**需求摘要逐项验证**

- [x] history 不出现 `status: "closed"`：目标测试 `filters closed and child agents before applying the history limit` 通过。
- [x] history 不出现有效 parent-agent label 条目：同一目标测试通过。
- [x] 过滤项不占十条上限：同一目标测试断言 `root-history-10` 出现。
- [x] 空闲与活跃使用统一会话状态区域：`global-status-bar.test.tsx` 空闲 ready case 和 active sessions case 通过。
- [x] 空闲显示 running 0 且没有 needs attention 0：`global-status-bar.test.tsx` 断言 running count `0` 且无 attention count。
- [x] errors 保持静态计数：目标 diff 未修改 errors 行为；无 errors surface/panel/onPress 新增。

**明确不做逐项核对**

- [x] 不改 `HostStatusSummaryPayload` / protocol / server / client SDK：目标 diff 只涉及 status-summary app 文件与流程产物。
- [x] 不新增 errors 可点击能力、错误会话、错误 panel、额外 fetch 或 legacy RPC fallback：目标 diff 无相关新增。
- [x] 不改 archive、关闭、子 agent 关系、history 持久化、排序、导航或 status bar 高度：目标 diff 无相关生产改动；history 仅本地展示过滤。
- [x] 空闲入口不展示单独 needs attention 0：测试覆盖。

**关键决策落地**

- [x] 先过滤再截断：`agents.filter(isStatusBarHistoryVisible).slice(0, HISTORY_LIMIT)`。
- [x] 静态/交互组件边界分离：static 分支不进入 interactive component。
- [x] 零 attention 不占独立指标：`TriggerContent` 仍只在 `attentionCount > 0` 时显示 warning metric。

**挂载点反向核对**

- [x] `packages/app/src/status-summary/global-status-bar.tsx`：ready 分支挂载点一致。
- [x] `packages/app/src/status-summary/status-bar-running-sessions.tsx`：history 过滤和 static/interactive 边界一致。
- [x] 反向 grep：`StatusBarRunningSessionsTrigger`、`StatusBarSessionHistoryTrigger`、`status-bar-sessions-static`、`isStatusBarHistoryVisible` 的本 feature 引用均在设计挂载点或对应测试内。
- [x] 拔除沙盘推演：移除 `GlobalStatusBar` ready 分支挂载和 `StatusBarRunningSessionsTrigger` selector 后，本 feature UI 行为消失；无其他生产残留挂载。

## 3. 验收场景核对

- [x] **S1**：当前已加载 history 集合含 closed、子 agent 和根 agent -> 前两者不出现，后续已加载根 agent 补足十条。
  - 证据来源：目标 jsdom 测试。
  - 结果：通过。
- [x] **S2**：history 只有过滤项 -> 显示既有空态，不显示 query 错误态。
  - 证据来源：目标 jsdom 测试。
  - 结果：通过。
- [x] **S3**：无会话 snapshots -> status bar 没有独立 running/attention chips，显示会话状态静态视图和 running 0；不是 button，且不挂载 panel、open state 或 route effect。
  - 证据来源：目标 jsdom 测试 + 代码边界复核。
  - 结果：通过。
- [x] **S4**：有 running/attention/recent snapshots -> 使用同一入口外观，仍可打开既有 desktop dropdown 或 compact sheet，并维持既有导航和固定功能。
  - 证据来源：目标 jsdom 测试。
  - 结果：通过。
- [x] **S5**：attention 为 0 -> 不显示 attention 0 指标；attention 大于 0 -> 保持既有 warning metric。
  - 证据来源：目标 jsdom 测试。
  - 结果：通过。
- [x] **S6**：errors 计数 -> 继续是现有静态 chip，不具备点击能力。
  - 证据来源：diff 复核。
  - 结果：通过。

**功能性前端验证**

- [x] 自动化 DOM render 验证：目标 jsdom 测试覆盖核心 UI 状态和交互路径。
- [x] 真实浏览器 / 移动设备肉眼验证：未运行；记录为 residual risk，不承载核心自动化验收缺口。

**review 报告重点复核**

- [x] 空闲 static view 不可交互：测试和代码边界已覆盖。
- [x] history closed / parent label 过滤：测试已覆盖。
- [x] desktop dropdown、compact sheet、navigation、pin controls、history refresh：目标测试通过。
- [x] review residual risk：真实设备/浏览器触感未跑，保留为 residual risk。

**QA 报告重点复核**

- [x] 验证证据来源：`.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-qa.md`。
- [x] QA 报告覆盖 design 关键场景和 review QA focus。
- [x] QA feature type 为 functional，核心路径有运行证据。
- [x] failed / blocked 项为 none。
- [x] residual-risk 未承载核心自动化验收缺口。
- [x] Evidence pack、DoD Results、Gate Results 已复核；blocking DoD 均有 pass evidence。

## 4. 术语一致性

- 历史可见会话：代码局部命名 `isStatusBarHistoryVisible`，语义一致。
- 子 agent：生产代码复用 `getParentAgentIdFromLabels`，没有硬编码替代语义。
- 会话状态触发器 / 会话状态静态视图：代码命名 `StatusBarRunningSessionsTrigger`、`SessionStatusStaticView`、`InteractiveRunningSessionsTrigger` 与 design 一致。
- 空闲状态：测试和代码以 no snapshots 表达，没有引入新业务术语。
- 防冲突：未引入新的协议、server 或 persisted term。

## 5. 领域影响盘点（提示而非代写）

- [x] 新名词候选：none。design 第 4 节明确本 feature 只改变 status-summary app UI slice，不引入系统级新名词、协议或持久化流程。
- [x] 结构性选择候选：none。静态/交互边界是局部 UI 组件边界，不满足 ADR 的难回退 / 跨模块结构性决策条件。
- [x] 流程级约束候选：none。无新的系统级错误语义、幂等约束或扩展点规约。
- [x] docs / architecture：无需更新 `docs/architecture.md`、`docs/agent-lifecycle.md` 或 `.codestable/requirements/`。

## 6. requirement delta / clarification 回写

- [x] Design frontmatter 没有 `requirement` 字段。
- [x] 本 feature 不新增 daemon/protocol/持久化能力；属于已确认 status bar UI follow-up。
- [x] `.codestable/requirements/` 只有 `.gitkeep`，无对应 current/draft requirement。
- 结论：无 requirement 影响，不需要 req delta / clarification 回写。

## 7. roadmap 回写

- [x] Design frontmatter 没有 `roadmap` / `roadmap_item` 字段。
- [x] design-review 只说明它是 standalone post-roadmap UI follow-up。
- 结论：非 roadmap 起头，跳过 roadmap items.yaml 与主文档回写。

## 8. attention.md 候选盘点

- [x] 本 feature 未暴露需要补入 attention.md 的项目级命令、环境、流程或工具陷阱。
- [x] `mise` android-sdk warning 多次出现但命令均 exit 0，暂作为当前环境噪声，不沉淀为项目规则。

## 9. 遗留

- 后续优化点：none。
- 已知限制：真实浏览器 / 移动设备视觉和 native accessibility tree 未在本轮运行环境中验证。
- 实现阶段顺手发现：none。

## 10. 最终审计

- 验证证据来源：`.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-qa.md`
- Evidence sources:
  - `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-evidence-pack.md`
  - `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-dod-results.json`
  - `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-scope-gate.json`
- 聚合命令：
  - `mise exec nodejs@22.20.0 -- npx vitest run packages/app/src/status-summary/status-bar-running-sessions.test.tsx packages/app/src/status-summary/global-status-bar.test.tsx --bail=1` -> exit 0，2 files / 30 tests passed。
  - `mise exec nodejs@22.20.0 -- npm run lint -- packages/app/src/status-summary/global-status-bar.tsx packages/app/src/status-summary/status-bar-running-sessions.tsx packages/app/src/status-summary/global-status-bar.test.tsx packages/app/src/status-summary/status-bar-running-sessions.test.tsx` -> exit 0，0 warnings / 0 errors。
  - `mise exec nodejs@22.20.0 -- npm run typecheck` -> exit 0。
  - `git diff --check -- packages/app/src/status-summary/...` -> exit 0。
  - `rg "console\\.log|console\\.error|debugger|TODO|FIXME|XXX" packages/app/src/status-summary/...` -> exit 1，无命中。
- 场景复核：re-verified 6 / trust-prior-verify 1。
  - trust-prior-verify：真实浏览器 / 移动设备视觉与 native accessibility tree，依赖代码边界和 jsdom 证据，建议用户终审肉眼确认。
- 交付物复核：
  - 代码：status-summary app UI 改动存在。
  - 配置 / schema / 路由 / protocol / server / client SDK：无改动。
  - 文档：CodeStable implementation / review / QA / acceptance 产物落盘。
  - requirement / roadmap：不适用。
- 完整工作区复核：
  - 本 feature target diff：四个 app 文件 + feature 目录产物。
  - Staged diff：none。
  - Unrelated baseline dirty：`.codestable/reference/*`、`.codestable/runtime-manifest.json`、`.codestable/reference/solution-depth-conventions.md`。
- diff 清洁度：通过；无 debug 输出、临时 TODO/FIXME/XXX、注释掉代码、whitespace error 或方案外 target diff。
- 知识沉淀出口：attention / compound / docs 均无候选。
- 结论：通过。所有 checklist checks 已标记 `passed`，review / QA / acceptance 均为 `passed`。
