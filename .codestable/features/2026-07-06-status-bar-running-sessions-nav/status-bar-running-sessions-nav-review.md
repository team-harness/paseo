---
doc_type: feature-review
feature: 2026-07-06-status-bar-running-sessions-nav
status: passed
reviewer: subagent
reviewed: 2026-07-06
round: 2
---

# status-bar-running-sessions-nav 代码审查报告

## 1. Scope

- Design: `.codestable/features/2026-07-06-status-bar-running-sessions-nav/status-bar-running-sessions-nav-design.md`
- Checklist: `.codestable/features/2026-07-06-status-bar-running-sessions-nav/status-bar-running-sessions-nav-checklist.yaml`
- Evidence pack: `.codestable/features/2026-07-06-status-bar-running-sessions-nav/status-bar-running-sessions-nav-evidence-pack.md`
- Code: `packages/app/src/status-summary/*`
- Reviewer agent round 1: `1d83adeb-e419-4aa8-b78d-13cbb266ffed`
- Reviewer agent round 2: `8806c66a-cd3f-4d31-86a9-cc5cac7920ac`

## 2. Findings

### blocking

none.

### important

none.

已解决的 round 1 important：

- I1. 证据包对手工/截图验收支撑不足。
  - 处理：新增 `packages/app/e2e/status-bar-running-sessions.spec.ts`，覆盖 desktop anchored panel 和 compact web sheet；DoD `CMD-007` 纳入 Playwright e2e 并通过。
- I2. checklist `checks` 仍为 `pending`，但 steps 已 done、evidence pack 已 passed。
  - 处理：checklist C1-C8 已回写为 `passed`。

round 2 reviewer finding：

- P2 / confidence medium-high：QA/evidence 对 compact 覆盖表述偏满。新增 Playwright 覆盖的是 Desktop Chrome 的 390x844 compact web viewport，没有验证 native hardware back、真实 safe area、Android/iOS Gorhom bottom sheet 生命周期。
  - 处理：QA 和 evidence residual risk 改为明确记录 native compact test gap；不阻塞本 feature，因为 design 的核心 regression 已用 web compact + component state 覆盖，native 设备证据留给后续 `status-bar-polish-hardening`。

### nit

- N1. `hitSlop={6}` 可改成显式对象；React Native 支持数字形态，当前不作为缺陷处理。
- N2. 组件测试大量 mock UI primitives，能验证本模块状态流，但不能真实覆盖 DropdownMenu/AdaptiveModalSheet 平台行为。

## 3. Scope Checks

- In-place trigger：当前实现已在 desktop 和 compact 下移除原 running/attention chips，改为单个 sessions trigger。
- List order/dedup：`buildStatusBarSessionList` 按 attention > running > recent 分组并按 agentId 去重。
- Navigation boundary：执行器只调用 `navigateToAgent` / `navigateToWorkspace`，未直接拼 Expo Router route。
- Workspace action：缺 workspaceId 或 workspace 不在 live workspace set 时隐藏 workspace action。
- Panel lifecycle：route/server 变化、items 变空、导航成功会关闭 panel/sheet。
- Scope grep：无 direct router/build route/provider usage/fetchAgents/lifecycle mutation/useUnistyles 越界命中。

## 4. Test And QA Focus

- 真实 web/Electron 验证 desktop：trigger 锚定底部状态栏，Esc/outside press/backdrop 关闭，route change 关闭，打开不改变 footer 高度。
- compact/native 验证：AdaptiveModalSheet 打开/关闭，back/backdrop 关闭，底部 safe area 正常，row press 先关闭再导航。
- checklist checks 必须在 QA/acceptance 后回写，不能停留在 pending。

## 5. Residual Risk

- review 未修改代码。
- OCR 对 `cwd` nullable 的两条担心已核验为误报；协议 schema 中 `cwd` 是 required string。
- 真实 native compact 的 hardware back、safe area、Gorhom bottom sheet 生命周期未由当前 Playwright 覆盖；已记录为 QA/evidence test gap，后续 polish/hardening 继续补设备或 Maestro 证据。

## 6. Verdict

status: passed。

代码实现满足 design；round 1 的真实 UI 证据缺口已由 Playwright e2e 补齐。剩余 native compact 设备证据是后续 hardening test gap，不是本 feature blocking。
