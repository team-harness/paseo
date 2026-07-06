---
doc_type: feature-acceptance
feature: 2026-07-06-global-status-bar-shell
status: passed
accepted: 2026-07-06
round: 1
---

# global-status-bar-shell 验收报告

> 阶段：阶段 3（验收闭环）
> 验收日期：2026-07-06
> 关联方案 doc：`.codestable/features/2026-07-06-global-status-bar-shell/global-status-bar-shell-design.md`

## 1. 接口契约核对

- [x] `HostStatusBarLayout`：实现为 host route content + footer 的 flex column 容器，content `flex: 1 / minHeight: 0`。
- [x] `GlobalStatusBar`：消费 `useGlobalStatusBarView(serverId)` 的 view model，经 `useGlobalStatusBarChromeState` 叠加 focus mode hidden。
- [x] `HostBottomChromeProvider` / `useHostBottomChromeInset`：状态栏可见且拥有 bottom safe area 时，贴底 leaf 得到 effective bottom inset `0`。
- [x] `StatusBarChip` 等价内部组件：固定高度 chip，按 row tone 映射 theme status tokens。

## 2. 行为与决策核对

- [x] host-only mount：只在 `packages/app/src/app/h/[serverId]/_layout.tsx` 的 `HostRouteProvider` 内挂载。
- [x] participating footer：未用 absolute/fixed bottom overlay；footer 参与布局。
- [x] bottom safe-area ownership：`AgentPanel` composer、settings bottom padding、archived callout 都通过 bottom chrome helper 扣减重复 inset。
- [x] display-only：未实现运行 session 详情弹层、hover card、bottom sheet、Portal 或导航动作。
- [x] no fallback/client fanout：shell 不调用 daemon client、provider usage、agent list、timeline 或旧 RPC。
- [x] focus mode hidden：focus mode 由 shell 层读取 `panel-store` 并返回 null。
- [x] root layout 反向核对：root `_layout.tsx` 未新增 status bar mount。

## 3. 验收场景核对

- [x] `/h/[serverId]/*` host 内显示底部栏：component test 和 host layout diff 覆盖。
- [x] unsupported/focus/hidden 不占 footer：component test 覆盖，provider 不扣减 leaf inset。
- [x] ready rows 和 compact rows：component test 覆盖 total/today/running/attention 优先级。
- [x] loading/offline/error quiet states：component test 覆盖。
- [x] bottom inset 不重复：component test + direct inset grep 覆盖。
- [x] review Test And QA Focus：archived callout 已修复；error/hidden 测试已补；DoD grep 已复跑。
- [x] QA 报告 passed，failed/blocked 为 none。
- [x] Evidence pack、DoD Results、Gate Results 已复核，blocking 为 none。

浏览器/设备截图未在本轮执行；当前 feature 的核心几何契约由组件测试和 grep 证明，视觉矩阵交由后续 hardening feature。

## 4. 术语一致性

- `HostBottomChromeProvider`、`useHostBottomChromeInset`、`HostStatusBarLayout`、`GlobalStatusBar` 与 design 术语一致。
- 禁用范围词反查：本 feature 没有新增 provider usage fallback、navigation target、bottom sheet 或 root layout mount。

## 5. 领域影响盘点

- 新术语 `Bottom chrome inset` 已在 design 中定义；这是 UI layout 内部约束，暂不需要单独走 `cs-domain` 写 ADR。
- 结构性选择 `participating flex footer` 来自 roadmap/design，当前实现未引入新跨模块架构决策；不需要额外 ADR。
- 流程级约束“状态栏可见时 footer 拥有 bottom safe area”后续可能值得在 polish/hardening 阶段沉淀到 `docs/design.md` 或 `docs/expo-router.md`。

## 6. requirement delta / clarification 回写

无 requirement 影响。本 feature 是 roadmap 子项实现，没有独立 owner-approved requirement delta 需要应用。

## 7. roadmap 回写

- [x] `.codestable/roadmap/global-status-bar/global-status-bar-items.yaml` 中 `global-status-bar-shell` 已回写为 `done`，feature 为 `2026-07-06-global-status-bar-shell`。
- [x] `.codestable/roadmap/global-status-bar/global-status-bar-roadmap.md` 第 5 节对应条目已同步为 `done`。
- [x] `.codestable/roadmap/global-status-bar/goal-state.yaml` 中 feature 4 已标记 `accepted`，`current_feature_index: 4`。

## 8. attention.md 候选盘点

- 候选：DoD 里用于证明“没有残留直写”的 `rg` 命令应写成 `! rg ...`，否则无命中会因为 exit 1 被 runner 判失败。该经验属于 CodeStable DoD 命令写法，不一定是 Paseo 项目长期注意事项；暂不写入 `.codestable/attention.md`。

## 9. 遗留

- 后续优化点：真实设备/浏览器截图、键盘开合、compact 视觉矩阵由 `status-bar-polish-hardening` 承接。
- 已知限制：本 feature 不提供运行中 session 详情、导航或 provider plan usage 入口；这些属于后续 roadmap item。
- 顺手发现：root `_layout.tsx` 既有 `useUnistyles` 命中，不属于本 feature。

## 10. 最终审计

- Re-verified:
  - `npx vitest run packages/app/src/status-summary/global-status-bar.test.tsx --bail=1`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run format:check`
  - scope gate / DoD runner / evidence pack
- Trust-prior-verify:
  - 独立 Paseo reviewer 输出无 blocking，important 已修复后复跑验证。
- 交付物落盘：
  - implementation files、review、QA、acceptance、scope gate、DoD results、evidence pack 均存在。
- Diff 清洁度：
  - 当前 dirty diff 仅包含本 feature 范围和 roadmap/status 回写。
- Verdict: passed。
