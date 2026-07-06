---
doc_type: feature-review
feature: 2026-07-06-global-status-bar-shell
status: passed
reviewer: subagent
reviewed: 2026-07-06
round: 1
---

# global-status-bar-shell 代码审查报告

## 1. Scope

- Design: `.codestable/features/2026-07-06-global-status-bar-shell/global-status-bar-shell-design.md`
- Checklist: `.codestable/features/2026-07-06-global-status-bar-shell/global-status-bar-shell-checklist.yaml`
- Evidence pack: `.codestable/features/2026-07-06-global-status-bar-shell/global-status-bar-shell-evidence-pack.md`
- Code: `packages/app/src/status-summary/*`, host layout, `AgentPanel`, settings bottom padding, archived callout
- Reviewer agents:
  - `ffee8a28-d1ae-4153-99a5-b23a8ccaf3e2`
  - `91911f29-2884-48c2-9f32-87579a9648ec`

## 2. Findings

### blocking

none。

### important

- Archived agent 状态的 `ArchivedAgentCallout` 原本仍直接使用 `insets.bottom`，状态栏可见时会与 footer 拥有的 bottom safe area 叠加，形成重复底部空带。
  - 处理：已改为 `useHostBottomChromeInset(insets.bottom)`，并将 bottom inset grep 改成无残留即通过的 DoD 命令。

- 初版测试未显式覆盖 `error` 与 `hidden` view kind。
  - 处理：已补充 `global-status-bar.test.tsx` 中 error 文案和 hidden 返回 null 的断言。

### nit

- `global-status-bar.tsx` 的 chip `maxWidth: 148` 是局部视觉常量；当前可接受，后续 polish/hardening 可抽常量或纳入视觉截图矩阵。
- checklist `checks` 在 implementation 阶段保持 pending，acceptance 阶段统一回写。

## 3. Scope Checks

- Host-only mount：状态栏只挂在 `packages/app/src/app/h/[serverId]/_layout.tsx` 的 `HostRouteProvider` 内。
- Participating footer：`HostStatusBarLayout` 使用 flex column，content `flex: 1 / minHeight: 0`，footer 不使用 absolute/fixed bottom overlay。
- Display-only：没有新增导航 handler、Portal、bottom sheet、hover card、provider usage fallback 或 daemon client fanout。
- Bottom chrome：`AgentPanel` composer、host settings scroll bottom padding、archived callout 均改用 `useHostBottomChromeInset`。
- Unistyles：新组件使用 `StyleSheet.create((theme) => ...)`，未新增 `useUnistyles()`。

## 4. Test And QA Focus

- archived agent 页面底部：状态栏 visible、unsupported hidden、focus hidden 时不应重复 bottom inset。
- compact/mobile 键盘打开/收起：active composer 和 archived callout 不应因 footer 多偏移。
- `ready/loading/offline/error/unsupported/hidden/focus hidden` 状态分支保持固定高度或返回 null。
- DoD grep 命中分类：
  - `packages/app/src/app/_layout.tsx` 的 `useUnistyles` 是既有 root layout 命中，本 feature 未修改 root layout。
  - `status-summary/query-core.ts` 和 `use-status-summary.test.ts` 的 `getStatusSummary` 属前置 app store 数据层，不是本 UI shell 新增 daemon 调用。
  - `paddingBottom: insets.bottom` grep 已无命中。

## 5. Residual Risk

- 没有完成真实设备键盘和截图验证；本轮以 component test、layout contract、grep 和 diff review 覆盖。更广泛视觉/compact hardening 已由 roadmap 后续 `status-bar-polish-hardening` 承接。

## 6. Verdict

status: passed。review 发现的 important 已修复并复跑目标测试、typecheck、lint、format check、scope gate、DoD runner 和 evidence pack。
