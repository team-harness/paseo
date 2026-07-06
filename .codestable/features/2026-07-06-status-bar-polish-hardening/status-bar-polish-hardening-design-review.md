---
doc_type: feature-design-review
feature: 2026-07-06-status-bar-polish-hardening
status: passed
reviewed: 2026-07-06
round: 2
---

# status-bar-polish-hardening feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-06-status-bar-polish-hardening/status-bar-polish-hardening-design.md`
- Checklist: `.codestable/features/2026-07-06-status-bar-polish-hardening/status-bar-polish-hardening-checklist.yaml`
- Intent / brainstorm: none
- Roadmap: `.codestable/roadmap/global-status-bar/global-status-bar-roadmap.md`, `.codestable/roadmap/global-status-bar/global-status-bar-items.yaml`
- Related docs: `docs/testing.md`, `docs/mobile-testing.md`, `docs/browser-capture-harness.md`, `docs/development.md`, `docs/design.md`, `docs/i18n.md`, `docs/expo-router.md`, `docs/floating-panels.md`, `docs/hover.md`, `docs/unistyles.md`
- Code facts checked: `package.json`, `packages/app/package.json`, `packages/app/src/i18n/resources.test.ts`, `packages/app/e2e/*`, `packages/app/maestro/*`, existing UI primitives by grep; `packages/app/src/status-summary/` currently does not exist because前置 feature 仍未实现。

### Independent Review

- Status: completed
- Detection: paseo
- Provider / agent: `claude/opus`, agent `7441c863-a5af-413b-b71a-2f1625bc4e20`
- Raw output: user message `<paseo-system> Agent 7441c863... finished`
- Merge policy: 已逐条核验 reviewer findings，合并 I1/I2/I3 与 nit/suggestion 到 design/checklist 修订或 residual risk。
- Gate effect: none after merge

## 2. Design Summary

- Goal: 作为 `global-status-bar` epic 的最后一个 UI 收口 feature，补齐状态栏的状态矩阵、route/viewport/layout 证据、running sessions 交互证据、a11y/i18n/copy、scope guards 和文档沉淀。
- Key contracts: 不新增协议/daemon/store 核心能力；只允许测试 fixture 复用前置已合并 seam、小型 polish/a11y/i18n 修正、targeted E2E/Maestro/截图证据和 docs/compound 回写。
- Steps: 7 步，新增 S0 前置落地闸门，随后覆盖 QA fixture、视觉状态 polish、route/safe-area/keyboard、running sessions interaction、a11y/i18n/copy、scope/docs/validation。
- Checks: 10 条，新增 C0 前置文件/测试存在性闸门，覆盖收口边界、状态矩阵、safe-area/keyboard、panel dismiss、i18n/a11y、scope guards、targeted test policy、docs backfill 和清洁度。
- Baseline / validation: 前置继承回归测试、状态栏目标 Vitest、i18n parity、可选 targeted Playwright、typecheck/lint/format、scope grep、compact/native 截图或手工证据。

## 3. Findings

### blocking

none.

### important

none.

已解决的 reviewer important：

- I1 前置测试文件不存在但被列为 core DoD：design §1/§2.4/§3.4/§3.5 与 checklist S0/C0/CMD-001 已新增前置落地闸门，明确 `status-summary` 目录和前置目标测试缺失时停止 hardening、回前置 feature；CMD-002/003/004 标为继承回归测试，不把这些前置测试当成本 feature 独有交付。
- I2 “可新增测试 fixture seam” 与“不改前置 contract”冲突：design §1/§2.2/§2.4 与 checklist S1/C1 已收敛为只允许复用前置已合并的正式 seam；缺 seam 时回 `app-status-summary-store` 或 shell/nav，不在 hardening 内新增生产可见注入点。
- I3 keyboard-open footer 行为仍是分支：design §1/§2.4/§3.1/§3.3/§4 与 checklist S3/C3 已收敛 v1 keyboard policy：键盘打开时 footer 仍可见，composer 通过 effective inset 避免重复偏移；若真机证明不可行，必须回 shell design 修订，而非 hardening 内静默改策略。

### nit

none.

已处理的 reviewer nit：

- N1 CMD-009 噪音过大：scope guard 已从整个 `packages/app/e2e` / `packages/app/maestro` 收窄到 `packages/app/e2e/status-bar*.spec.ts` / `packages/app/maestro/status-bar*` + `packages/app/src/status-summary`。
- N2 CMD-010 模式错位：grep 从 `status-summary` 扩为 `status.summary` / `HostStatusSummaryPayload`，并要求将前置 protocol/client/server 合法实现人工分类为非 hardening diff。
- N3 i18n 八语言义务未点破：design CMD-004 与 checklist S5/C5/CMD-005 已明确新增 copy key 需补齐 `en/ar/es/fr/ja/pt-BR/ru/zh-CN`。

### suggestion

- SG1 证据矩阵表格化：design 已有 `StatusBarHardeningEvidence` shape、§2.2 记录要求和 §3.3 matrix。实现/QA 阶段应把它落成可填 QA 表；本 design 不强制新增生产类型，边界正确。

### learning

- `packages/app/src/i18n/resources.test.ts` 是真实的八语言 parity、fallback ratio 和 interpolation placeholder 闸门；它适合作为本 feature copy/a11y hardening 的 core command。
- 收口 feature 可复跑前置测试作为回归门，但要把“继承回归测试”和“本 feature 独有交付”区分清楚，避免 file-not-found 被误判成 hardening 失败。
- `packages/app/src/status-summary/` 目前尚不存在，符合前置 features 仍处 design passed / 未实现状态；hardening implementation 必须排在前置实现之后。

### praise

- 测试负载纪律正确：目标 Vitest 单文件、targeted Playwright `core:false` 且禁止跑全量 Playwright，与 repo 测试规则一致。
- 前置 safe-area/keyboard/panel-dismiss 风险承接完整：shell 的 bottom chrome/repeated inset 风险和 nav 的 dismiss lifecycle/close-before-nav 都映射到 S3/S4/C3/C4。
- 范围守护自洽：协议、daemon、provider usage、agent lifecycle mutation、root layout mount 都有反向核对和 grep。
- §2.5 “不做微重构”结论恰当：把 `AgentPanel` keyboard/inset 结构性拆分外推到独立 `cs-refactor`，不混入收口。

## 4. User Review Focus

- 用户需要重点拍板：hardening 不新增功能，重点是最终证据矩阵；v1 keyboard policy 是“键盘打开时 footer 仍可见且 composer 不额外偏移 footer 高度”。
- implement 需要重点遵守：S0 前置落地闸门先过；只复用前置已合并 seam；目标测试缺失要回前置 feature；本 feature 独有交付是 targeted spec/flow、a11y/i18n/copy polish、docs/compound 回写和证据矩阵。
- code review / QA / acceptance 需要重点复核：safe-area/keyboard/panel dismiss 的真实设备或截图证据，scope grep 的人工分类，八语言 i18n parity，docs 回写是否只包含稳定结论。

## 5. Evidence Confidence Ledger

| Check                         | Verdict | Evidence Class | Basis                                                                                                                                                                           | Follow-up               |
| ----------------------------- | ------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Acceptance Coverage Matrix    | pass    | E/C            | design §3.3 覆盖状态矩阵、host route visibility、bottom safe-area、keyboard、panel dismiss、compact sheet、a11y/i18n、scope guard、docs backfill；reviewer 核验前置风险均有承接 | 实现/QA 按矩阵填证据表  |
| DoD Contract                  | pass    | E              | design §3.4/§3.5 和 checklist `dod.commands` 区分 S0 前置闸门、继承回归测试、本 feature 独有交付                                                                                | none                    |
| Steps and checks traceability | pass    | E              | S0-S6 与 C0-C9 均可追溯 design §1/§2/§3；YAML 已校验通过                                                                                                                        | none                    |
| Roadmap contract compliance   | pass    | E/C            | roadmap item 要求 compact/desktop、旧 daemon gate、无数据/错误态、可访问性、视觉回归、文档沉淀；design 覆盖且不扩协议/daemon/provider/lifecycle                                 | none                    |
| Module interface design       | pass    | E/C            | 本 feature 不新增生产 module interface；QA seam 明确只能复用前置已合并 seam，缺 seam 回前置 feature                                                                             | 前置实现后复核实际 seam |
| Validation and artifacts      | pass    | E/C            | 命令入口真实：i18n parity、targeted Playwright filter 语法成立；status-summary 目标文件待前置实现，已由 CMD-001/S0 gate 处理                                                    | hardening 启动时先过 S0 |

Summary: E=5, C=1, H=0, H-only core checks=none。

## 6. Residual Risk

- R1 前置仍未落地：items.yaml 六项均 `in-progress`，但当前仓库没有 `packages/app/src/status-summary/`。这不是 design 缺陷；S0/C0/CMD-001 已将其变成 hardening 启动闸门。
- R2 前置测试文件名可能漂移：CMD-001 要求缺文件时停止并明确等价目标测试路径，避免静默打偏。
- R3 compact keyboard 仍需真机/模拟器证据：设计已收敛产品判据，但 component test 无法证明 iOS home indicator + keyboard shift；QA 不能省略截图/手工记录。

## 7. Verdict

- Status: passed
- Next: 在 epic child batch 中保持 design `draft`，返回 `cs-epic`；若所有 child design-review 均 passed，则进入所有 design 统一确认 checkpoint。
