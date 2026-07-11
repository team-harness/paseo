---
doc_type: feature-implementation-report
feature: 2026-07-11-status-bar-history-and-errors
status: passed
stage: implementation.before_review
---

# Status bar 历史与会话状态 UI implementation report

## 动了哪些文件

目标代码与测试：

- `packages/app/src/status-summary/status-bar-running-sessions.tsx`
- `packages/app/src/status-summary/global-status-bar.tsx`
- `packages/app/src/status-summary/status-bar-running-sessions.test.tsx`
- `packages/app/src/status-summary/global-status-bar.test.tsx`

流程产物：

- `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-checklist.yaml`
- `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-scope-gate.json`
- `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-dod-results.json`
- `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-evidence-pack.md`
- `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-evidence-pack.json`

当前 worktree 另有既存 `.codestable/reference/*` dirty 变更，本轮未读取为实现输入、未修改、未纳入 scope gate 归因。

## 改了哪些函数 / 类型

**步骤 1：历史选择**

- `packages/app/src/status-summary/status-bar-running-sessions.tsx:334` `StatusBarSessionHistoryTrigger` 修改：history items 先过滤再截断。
- `packages/app/src/status-summary/status-bar-running-sessions.tsx:484` `isStatusBarHistoryVisible` 新增：只允许 `status !== "closed"` 且 `getParentAgentIdFromLabels(labels) === null` 的根 agent 进入状态栏 history。
- `packages/app/src/status-summary/status-bar-running-sessions.test.tsx:712` 新增行为测试：closed 和 child agent 不显示，过滤后第 10 个 root history 补位。

**步骤 2：统一静态结构**

- `packages/app/src/status-summary/global-status-bar.tsx:92` `StatusBarContent` 修改：ready 状态永久移除 running/attention primary chips。
- `packages/app/src/status-summary/global-status-bar.tsx:107` `StatusBarContent` 修改：ready 状态始终挂载 `StatusBarRunningSessionsTrigger`。
- `packages/app/src/status-summary/global-status-bar.test.tsx:350` 更新空闲 ready 状态断言：显示 `status-bar-sessions-static` 和 running `0`，不显示独立 running/attention chips。

**步骤 3：空闲交互边界**

- `packages/app/src/status-summary/status-bar-running-sessions.tsx:142` `StatusBarRunningSessionsTrigger` 修改为 selector 边界：无会话快照时返回静态视图，有会话快照时才进入 interactive 子组件。
- `packages/app/src/status-summary/status-bar-running-sessions.tsx:167` `SessionStatusStaticView` 新增：仅 `View + TriggerContent`，`testID="status-bar-sessions-static"`。
- `packages/app/src/status-summary/status-bar-running-sessions.tsx:177` `InteractiveRunningSessionsTrigger` 拆出：保留既有 open state、route effect、DropdownMenu、AdaptiveModalSheet 和 navigation。
- `packages/app/src/status-summary/global-status-bar.test.tsx:363` 验证静态视图是 `DIV`，没有 sessions trigger/panel。

**步骤 4：回归验证**

- `packages/app/src/status-summary/status-bar-running-sessions.test.tsx` 既有 active desktop、compact sheet、navigation、pin、history、empty state 测试继续通过。
- `packages/app/src/status-summary/status-bar-running-sessions.test.tsx` 补充 filtered-only history 空态测试：当已加载 history 全部被 closed/parent label 过滤掉时显示既有 empty state。
- `packages/app/src/status-summary/global-status-bar.test.tsx:474` compact ready 状态更新为同样显示静态会话视图，不回退 running/attention chips。

## 是否触碰方案外文件

否。生产代码只触碰 design 允许的两个 status-summary 文件；测试只触碰对应两个测试文件。未修改 errors、server、protocol、client SDK、feature gate、RPC、agent lifecycle、archive、分页或额外 fetch。

## 是否引入方案外新概念

否。新增命名 `SessionStatusStaticView` 与 design 第 0 节“会话状态静态视图”一致；`isStatusBarHistoryVisible` 对应 design 的“历史可见会话”局部谓词。

## 第一性原则 pre-pass

- 外部行为：状态栏 history 不展示 closed/child agent；ready status bar 空闲和活跃都显示统一会话状态区域。
- 不可破约束：不改 daemon/protocol/errors；不新增 fetch；空闲路径不得创建 open state/effect/overlay。
- 最小充分改动：在现有 status-summary 组件内筛选数据、拆静态/交互组件边界、更新目标测试。
- 必须不写：分页补足、错误 panel、legacy RPC fallback、direct router 调用、跨模块抽象。

## 方案深度与代码质量反射检查

未使用 fake/stub/正则替代核心逻辑；历史父子判定复用 `getParentAgentIdFromLabels`。没有触发需要新增 step 的文件拆分、参数膨胀或万能 helper 信号；本次只是在既有 status-summary UI slice 内延伸已有职责。

## Step 证据

**步骤 1：历史选择**

- 退出信号：过滤项不出现，当前已加载集合内后续根 agent 可补足可见 history。
- RED：`mise exec nodejs@22.20.0 -- npx vitest run packages/app/src/status-summary/status-bar-running-sessions.test.tsx --bail=1` 失败，`status-bar-history-row-closed-latest` 仍存在。
- GREEN：加入 `isStatusBarHistoryVisible` 后同命令通过，18 tests passed。
- VERIFY：DoD CMD-001 通过，30 tests passed。
- 清洁度：无新增 debug 输出、临时 TODO/FIXME、注释掉代码或无用 import。

**步骤 2：统一静态结构**

- 退出信号：空闲状态显示同形 running 0 入口，且没有独立 running/attention chips。
- RED：`mise exec nodejs@22.20.0 -- npx vitest run packages/app/src/status-summary/global-status-bar.test.tsx --bail=1` 失败，`global-status-bar-row-running` 仍存在。
- GREEN：ready rows 永久过滤 running/attention，并始终挂载会话状态区域后，目标双文件测试通过。
- VERIFY：DoD CMD-001 通过，30 tests passed。
- 清洁度：无新增 debug 输出、临时 TODO/FIXME、注释掉代码或无用 import。

**步骤 3：空闲交互边界**

- 退出信号：空闲静态视图不是 button，且不挂载 open state、route effect 或 panel；活跃入口仍可打开并导航。
- RED：同一 global status bar RED 中 `status-bar-sessions-static` 缺失，无法证明静态非交互边界。
- GREEN：拆出 `SessionStatusStaticView` 和 `InteractiveRunningSessionsTrigger` 后，静态视图为 `DIV`，无 `status-bar-sessions-trigger` 和 `status-bar-sessions-panel`。
- VERIFY：既有 active desktop/compact/navigation 测试仍通过，DoD CMD-001 通过。
- 清洁度：静态路径不包含 Pressable、DropdownMenu、AdaptiveModalSheet、open state 或 route effect。

**步骤 4：回归验证**

- 退出信号：目标测试、格式、lint 和 typecheck 通过，或记录可复现的既有阻塞。
- VERIFY：DoD CMD-001 至 CMD-004 全部 exit 0。
- 补强证据：独立 reviewer 建议添加 filtered-only history 空态测试；已补测试并刷新 DoD，CMD-001 为 30 tests passed。
- 清洁度：scope gate passed；目标 app 文件无 debug/TODO/FIXME/注释掉代码。

## TDD 证据

- 行为 1：history 先过滤 closed/child 再截断；RED/GREEN/VERIFY 见步骤 1。
- 行为 2：空闲 ready status bar 使用统一会话状态静态视图；RED/GREEN/VERIFY 见步骤 2。
- 行为 3：空闲静态视图非交互且 active 交互路径不回归；RED/GREEN/VERIFY 见步骤 3。
- 步骤 4 是验证 gate 汇总，不改变生产行为。

## 基线预检与清洁度

- 初始目标测试第一次运行被既有测试夹具阻断：`global-status-bar.test.tsx` 未 mock `Pin/PinOff`，被测模块导入时报错。
- 修复测试夹具后基线预检通过：2 files passed, 28 tests passed。
- 后续目标测试通过：2 files passed, 30 tests passed。
- `mise` 在多条命令 stderr 中报告 android-sdk cache/network warning；所有核心命令 exit 0，未影响本 feature 验证。

## Gate 结果

- Scope gate: `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-scope-gate.json`，`status: passed`。
- DoD runner: `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-dod-results.json`，`status: passed`。
- Evidence pack: `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-evidence-pack.md`，`status: generated`；`.json` 结果 `status: passed`。

## 实际交付物索引

- 代码：status bar history 可见性过滤；ready status bar 统一会话状态区域；空闲静态视图与 active interactive trigger 边界拆分。
- 测试：history closed/child 过滤补位；空闲 static sessions view；compact 空闲状态；Pin/PinOff mock 补齐。
- 文档/状态：checklist steps done；implementation report；scope/DoD/evidence pack。

## 知识回写候选

无候选。`mise` android-sdk warning 是环境 cache/network 噪声，命令 exit 0，暂不沉淀为项目约定。

## 最后一轮本地审计

- `mise exec nodejs@22.20.0 -- npx vitest run packages/app/src/status-summary/status-bar-running-sessions.test.tsx packages/app/src/status-summary/global-status-bar.test.tsx --bail=1`：exit 0，30 tests passed。
- `mise exec nodejs@22.20.0 -- npm run format:files -- packages/app/src/status-summary/global-status-bar.tsx packages/app/src/status-summary/status-bar-running-sessions.tsx packages/app/src/status-summary/global-status-bar.test.tsx packages/app/src/status-summary/status-bar-running-sessions.test.tsx`：exit 0。
- `mise exec nodejs@22.20.0 -- npm run lint -- packages/app/src/status-summary/global-status-bar.tsx packages/app/src/status-summary/status-bar-running-sessions.tsx packages/app/src/status-summary/global-status-bar.test.tsx packages/app/src/status-summary/status-bar-running-sessions.test.tsx`：exit 0。
- `mise exec nodejs@22.20.0 -- npm run typecheck`：exit 0。
- diff review：目标生产 diff 限于 app UI slice；无 protocol/server/errors/RPC/lifecycle/archive/fetch 变更。

## 推进顺序退出信号核对

- 历史选择：done。
- 统一静态结构：done。
- 空闲交互边界：done。
- 回归验证：done。

## 验收场景自检

- 已加载 history 集合内过滤并先于截断：`status-bar-running-sessions.test.tsx` 新增补位 case 覆盖。
- history 只有过滤项时显示既有空态：`status-bar-running-sessions.test.tsx` filtered-only empty state case 覆盖。
- 空闲与活跃入口统一：`global-status-bar.test.tsx` 空闲 case 和既有 active sessions case 覆盖。
- 空闲静态视图不可交互且无 overlay：`status-bar-sessions-static` 为 `DIV`，无 trigger/panel。
- 活跃 overlay/导航回归：既有 desktop dropdown、compact sheet、agent/workspace navigation 测试继续通过。
- attention 为 0 不展示 attention 0，running 数始终展示：空闲 case 断言 running `0` 且无 attention metric；既有 active case 覆盖 attention > 0。
- errors 静态计数：未改 errors 行为或可点击能力。
