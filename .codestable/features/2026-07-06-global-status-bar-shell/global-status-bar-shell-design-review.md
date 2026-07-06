---
doc_type: feature-design-review
feature: 2026-07-06-global-status-bar-shell
status: passed
reviewed: 2026-07-06
round: 2
---

# global-status-bar-shell feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-06-global-status-bar-shell/global-status-bar-shell-design.md`
- Checklist: `.codestable/features/2026-07-06-global-status-bar-shell/global-status-bar-shell-checklist.yaml`
- Intent / brainstorm: none
- Roadmap: `.codestable/roadmap/global-status-bar/global-status-bar-roadmap.md`, `.codestable/roadmap/global-status-bar/global-status-bar-items.yaml`
- Related docs: `docs/design.md`, `docs/expo-router.md`, `docs/unistyles.md`, `docs/hover.md`, `docs/floating-panels.md`, `docs/coding-standards.md`
- Code facts checked: `packages/app/src/app/h/[serverId]/_layout.tsx`, `packages/app/src/app/_layout.tsx`, `packages/app/src/screens/workspace/workspace-screen.tsx`, `packages/app/src/panels/agent-panel.tsx`, `packages/app/src/composer/index.tsx`, `packages/app/src/components/ui/status-badge.tsx`, `packages/app/src/components/ui/loading-spinner.tsx`, `packages/app/src/stores/panel-store/*`

### Independent Review

- Status: completed
- Detection: paseo
- Provider / agent: `claude/opus`, agent `88243f91-9442-495e-b19e-c6451d5f0460`
- Raw output: user message `<paseo-system> Agent 88243f91... finished`
- Merge policy: 已逐条核验独立 reviewer 的 facts，合并 B1/B2/I1/I2/N/S/R 到 design/checklist 修订或 residual risk。
- Gate effect: none after merge

## 2. Design Summary

- Goal: 在 host-scoped shell 底部渲染 display-only 状态栏基础壳，展示 usage/activity 摘要，并处理 layout、safe area、keyboard、focus mode。
- Key contracts: 挂载在 `packages/app/src/app/h/[serverId]/_layout.tsx`；状态栏作为 participating flex footer；footer 拥有 bottom safe area，并通过 bottom chrome context/helper 让贴底 leaf 扣减重复 inset；只消费 `useGlobalStatusBarView(serverId)`；不做导航、弹层、provider usage fetch 或旧 daemon fallback。
- Steps: 6 步，覆盖 shell layout、bottom chrome inset contract、状态分支、ready rows、safe area/keyboard/layout 验证、范围守护。
- Checks: 10 条，覆盖 host-scoped 挂载、非 overlay 布局、状态分支、bottom inset ownership、keyboard、tone mapping、范围守护、Unistyles 和验证命令。
- Baseline / validation: 目标 component test、typecheck、lint、format check、grep scope guard、bottom inset grep、workspace + 非 workspace host page 手工/截图验证、compact keyboard 验证。

## 3. Findings

### blocking

none.

已解决的 reviewer blocking：

- B1 bottom safe-area 双重消费：design §1/§2.1/§2.2/§2.3/§2.4/§3 已新增 bottom chrome inset 术语、归属决策、context/helper 挂载点、AgentPanel/settings consumer 约束、S2/S5/C4/C10/CMD-006。
- B2 keyboard shift 交互未定义：design §2.2 与 §3.1/§3.3 已明确键盘开合行为验证；checklist S5/C5 要求 composer 不因 footer 高度额外偏移，允许实现期若真机证据需要则键盘打开隐藏 footer并记录。

### important

none.

已解决的 reviewer important：

- I1 StatusBadge 与 4-tone 不匹配：design §2.1 已改为自有轻量 chip，`StatusBadge` 只作语义参照，并加入 default/ok/warning/danger 到 theme token 的映射约束；checklist C6 覆盖。
- I2 view model kinds 易错配：design §2.1 已钉住 hook 的六种 kind，并明确 focus-mode 由 shell 在 hook 外叠加、unsupported 由 shell 渲染为 hidden/null；关键假设记录前置尚未落地。

### nit

none.

已处理的 reviewer nit：

- N1 S4/C4 未覆盖重复 inset/keyboard：checklist 增 S2/S5/C4/C5/C10/CMD-006。
- N2 Usage 入口含糊：design §2.1/§2.2 改为 v1 不渲染 Usage 入口。
- N3 tone token 来源缺失：design §2.1 增 tone 映射表。

### suggestion

- FDR-S1 锚定 composer 浮层验证已采纳为非核心场景：design §2.2/§3.1/§3.3 与 checklist S5 要求 autocomplete/command popover 不被 footer 裁切或明显错位。
- FDR-S2 bottom chrome context 已采纳：design §1/§2.1/§2.3/§2.4 加 `HostBottomChromeProvider` / helper 约束。

### learning

- 参与式 footer 不是仅靠 flex 布局就能安全落地；一旦既有 leaf 直接消费 `insets.bottom` 或基于窗口底部做 keyboard shift，就必须定义 bottom chrome 的 safe-area/keyboard 归属。
- `StatusBadge` 当前只有 `success/error/muted`，不适合直接承载状态栏四 tone；状态栏应使用轻量 chip，同时遵守 theme token。

### praise

- 路由归属方案正确：挂 host layout，不挂 root layout；不新增/重排 host leaf screen。
- scope 守护清晰：nav/popover/provider usage/fallback 都有明确不做和 grep 反向核对。
- focus mode 来源单一：复用 `panel-store.desktop.focusModeEnabled`，不把 focus 状态塞进 app summary store。

## 4. User Review Focus

- 用户需要重点拍板：v1 继续支持 compact/mobile 状态栏，但实现必须处理 bottom chrome 与 keyboard；如果实现期真机发现 footer 与键盘冲突，允许键盘打开期间隐藏 footer并记录证据。
- implement 需要重点遵守：host layout 挂载、participating footer、bottom chrome context/helper、只读 view model、不做导航/弹层/fallback/provider usage。
- code review / QA / acceptance 需要重点复核：workspace composer 是否有重复 bottom inset、键盘开合是否错位、root layout 是否未挂载、grep scope guard 是否干净、compact 截图是否覆盖 home indicator 机型。

## 5. Evidence Confidence Ledger

| Check                         | Verdict | Evidence Class | Basis                                                                                                                                        | Follow-up                        |
| ----------------------------- | ------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Acceptance Coverage Matrix    | pass    | E/C            | design §3.3 覆盖 host pages、composer、bottom inset、keyboard、状态分支、scope guard；代码事实来自 `agent-panel.tsx` safe-area/keyboard 消费 | 实现期按矩阵取证                 |
| DoD Contract                  | pass    | E              | design §3.4/§3.5 与 checklist `dod.commands` 覆盖命令和 artifacts                                                                            | none                             |
| Steps and checks traceability | pass    | E              | S1-S6 与 C1-C10 均可追溯 design §1/§2/§3                                                                                                     | none                             |
| Roadmap contract compliance   | pass    | E/C            | roadmap 要求 host-scoped 底部栏、layout/safe-area；design 挂 host layout 且补 bottom chrome 归属                                             | none                             |
| Module interface design       | pass    | E/C            | 新增 UI props + bottom chrome context/helper seam；无新 wire protocol；hook kinds 与前置 store design 对齐                                   | 前置 merge 后复核实际 hook shape |
| Validation and artifacts      | pass    | E              | checklist/DoD 有目标测试、typecheck/lint/format、grep、manual/screenshot evidence                                                            | 真机/模拟器键盘验证不可省        |

Summary: E=5, C=1, H=0, H-only core checks=none。

## 6. Residual Risk

- R1 前置接口尚未落地：`app-status-summary-store` 仍是设计阶段，实际 `useGlobalStatusBarView` hook 不存在。实现启动前必须确认前置合并后的 kind/row shape 与本设计一致。
- R2 键盘交互需要真机/模拟器验证：component test 无法证明 iOS home indicator + keyboard shift 场景；S5/C5/Acceptance matrix 已要求截图或手工证据。
- R3 bottom chrome helper 可能触碰多个 leaf 的 safe-area 消费者；design 已将必须范围收窄到与状态栏相邻的 host bottom consumers，code review 需要防止扩散重构。

## 7. Verdict

- Status: passed
- Next: 在 epic child batch 中保持 design `draft`，返回 `cs-epic` 继续下一条 child feature。
