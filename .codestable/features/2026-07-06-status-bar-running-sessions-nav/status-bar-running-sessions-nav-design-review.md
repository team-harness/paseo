---
doc_type: feature-design-review
feature: 2026-07-06-status-bar-running-sessions-nav
status: passed
reviewed: 2026-07-06
round: 2
---

# status-bar-running-sessions-nav feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-06-status-bar-running-sessions-nav/status-bar-running-sessions-nav-design.md`
- Checklist: `.codestable/features/2026-07-06-status-bar-running-sessions-nav/status-bar-running-sessions-nav-checklist.yaml`
- Intent / brainstorm: none
- Roadmap: `.codestable/roadmap/global-status-bar/global-status-bar-roadmap.md`, `.codestable/roadmap/global-status-bar/global-status-bar-items.yaml`
- Related docs: `docs/design.md`, `docs/expo-router.md`, `docs/hover.md`, `docs/floating-panels.md`, `docs/unistyles.md`, `docs/coding-standards.md`
- Code facts checked: `packages/app/src/utils/navigate-to-agent/*`, `packages/app/src/stores/navigation-active-workspace-store/*`, `packages/app/src/navigation/workspace-route-navigation.ts`, `packages/app/src/components/adaptive-modal-sheet.tsx`, `packages/app/src/components/ui/dropdown-menu.tsx`, `packages/app/src/components/ui/floating.tsx`, `packages/app/src/components/ui/floating-panel-portal.tsx`, `packages/app/src/utils/time.ts`, `packages/app/src/components/context-window-meter.utils.ts`

### Independent Review

- Status: completed
- Detection: paseo
- Provider / agent: `claude/opus`, agent `80e13d2f-a11b-4e68-b851-9efe51ba33da`
- Raw output: user message `<paseo-system> Agent 80e13d2f... finished`
- Merge policy: 已逐条核验 reviewer findings，合并 I-1/I-2/I-3/I-4 与 nit/suggestion 到 design/checklist 修订或 residual risk。
- Gate effect: none after merge

## 2. Design Summary

- Goal: 为底部状态栏增加 running/attention/recent agent session 快照详情面板，并支持导航到 agent/workspace。
- Key contracts: trigger in-place 接管 shell activity chip；desktop 优先复用 `DropdownMenu` Modal/position/dismiss 内核；compact 用 `AdaptiveModalSheet`；导航只走 `navigateToAgent` / `navigateToWorkspace`；workspace secondary action 只对 live/known workspace 显示；不改协议、不 fetch provider usage、不做 agent lifecycle mutation。
- Steps: 5 步，覆盖 list model/format/navigation resolver、trigger、compact sheet、desktop DropdownMenu panel、范围守护与验证。
- Checks: 8 条，覆盖导航 helper、分组去重、workspaceId/live workspace 约束、desktop DropdownMenu、compact sheet、lifecycle、范围守护。
- Baseline / validation: 目标 unit/component tests、typecheck、lint、format check、grep scope guard、desktop/compact 手工或截图验证。

## 3. Findings

### blocking

none.

### important

none.

已解决的 reviewer important：

- I-1 desktop anchored panel 路径过重：design §1/§2 已改为优先复用 `DropdownMenu` / `DropdownMenuContent` 的 Modal、computePosition、backdrop、Esc/back/outside-press 能力；checklist C4 不再写死 Portal/FloatingSurface + host-relative measurement。
- I-2 trigger seam 含糊：design §1/§2.1/§2.3/§2.4 明确 trigger 是对 shell 既有 activity chip 的 in-place 升级，不新增并列区域。
- I-3 route change 关闭缺信号：design §2.2/checklist C6 明确用 `usePathname()` route change 关闭 panel/sheet。
- I-4 workspace 辅助动作 archived restore 语义：核验 `navigateToWorkspace` 不做 archived restore；design §1/§2.1/§2.2/§3 收窄为 workspace action 只对 live/known workspace 显示，archived/missing workspace 走 agent primary action 的 `navigateToAgent` restore/fallback。

### nit

none.

已处理的 reviewer nit：

- N-1 纯函数命名职责：design 改为 `buildStatusBarSessionList(...)` + deps-injected executor。
- N-2 compact 关闭时机：design 统一为 row press 先关闭再导航。
- N-3 per-agent time/usage 格式化归属：design §2.1/§2.3/§2.4 指定复用 `formatTimeAgo` / `formatTokenCount` 并集中在 format helper。
- N-4 grep 重叠：保留范围守护 grep 并要求人工分类；shell feature 的 grep 是前置阶段守护，不影响本 feature 合法引入导航 helper。

### suggestion

- S-1 deps 注入 executor 已采纳，便于单测对齐既有 `navigate-to-agent/resolve.ts` 模式。
- S-2 `anchorRef` 类型已调整为 `React.RefObject<View | null>`。

### learning

- `DropdownMenuContent` 在本仓库已不是简单菜单项容器，而是一个带 Modal、定位、backdrop、Esc/back、scrollable/maxHeight 的 anchored surface；对无输入的 desktop 状态栏详情面板，比手搓 Portal 更稳。
- `navigateToWorkspace` 与 `navigateToAgent` 的恢复语义不同：workspace 辅助动作不能假设 archived workspace 可恢复，agent 主动作才是安全入口。

### praise

- 越界守护清晰：不做 protocol/server/provider usage/lifecycle mutation，并有 grep。
- 导航复用 helper 优于手拼 route，符合 `docs/expo-router.md` 的 route ownership。
- compact 使用 `AdaptiveModalSheet`，规避 Android overflowing child hit-test 风险。

## 4. User Review Focus

- 用户需要重点拍板：详情面板第一版是 action surface，不是历史 sessions 页；workspace action 只在 live/known workspace 出现。
- implement 需要重点遵守：in-place 接管 activity chip、desktop 复用 DropdownMenu、compact 复用 AdaptiveModalSheet、先关闭再导航、缺/归档 workspace 不显示 workspace action。
- code review / QA / acceptance 需要重点复核：无直接 router/build route、route change 后无残留 panel、desktop/compact 都能关闭、长文本截断、无 agent lifecycle 操作。

## 5. Evidence Confidence Ledger

| Check                         | Verdict | Evidence Class | Basis                                                                                               | Follow-up                                      |
| ----------------------------- | ------- | -------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Acceptance Coverage Matrix    | pass    | E/C            | design §3.3 覆盖分组、导航、workspace 缺失/归档、trigger、compact sheet、desktop panel、scope guard | 实现期按矩阵取证                               |
| DoD Contract                  | pass    | E              | design §3.4/§3.5 与 checklist `dod.commands` 覆盖命令和 artifacts                                   | none                                           |
| Steps and checks traceability | pass    | E              | S1-S5 与 C1-C8 均可追溯 design §1/§2/§3                                                             | none                                           |
| Roadmap contract compliance   | pass    | E/C            | roadmap 要求 running session 快照和导航；design 覆盖且不越界                                        | none                                           |
| Module interface design       | pass    | E/C            | 新增 UI props/list item builder/navigation executor seam；无 wire protocol                          | 前置 merge 后复核实际 snapshot shape           |
| Validation and artifacts      | pass    | E              | checklist/DoD 有目标测试、typecheck/lint/format、grep、desktop/compact QA evidence                  | desktop DropdownMenu behavior 需手工或截图验证 |

Summary: E=5, C=1, H=0, H-only core checks=none。

## 6. Residual Risk

- R1 前置接口尚未落地：`status-summary/` 目录、`GlobalStatusBar`、`useGlobalStatusBarView`、`StatusAgentSnapshot` 实际 shape 仍依赖前置 feature。实现启动前必须校准字段名与 kind。
- R2 `DropdownMenuContent` 虽可接受任意 children，但它是菜单 primitive；实现期若遇到 row semantics 或 accessibility 限制，可局部抽取其 Modal positioning/dismiss 内核，但不得退回未定义 dismiss/measurement 的手搓 Portal。
- R3 shell feature 的旧 scope grep 会在本 feature 后命中 `navigateToWorkspace`，属于阶段性守护重叠；acceptance 需按当前 feature 的 scope guard 判定。

## 7. Verdict

- Status: passed
- Next: 在 epic child batch 中保持 design `draft`，返回 `cs-epic` 继续下一条 child feature。
