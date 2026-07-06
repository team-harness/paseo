---
doc_type: feature-review
feature: 2026-07-06-status-bar-polish-hardening
status: passed
reviewed: 2026-07-06
reviewer: subagent
reviewer_agent: 130d6805-17e0-4ca2-a829-2b21bab0bd49
round: 1
---

# status-bar-polish-hardening 实现审查

## 1. Reviewer

- Paseo subagent: `130d6805-17e0-4ca2-a829-2b21bab0bd49`
- Title: `review status bar polish hardening`
- Mode: independent read-only implementation review

## 2. Findings

### blocking

none。

### important

1. Compact sheet 条件挂载绕过 Gorhom lifecycle。
   - Reviewer 指出 `status-bar-running-sessions.tsx` 里 `{open ? <AdaptiveModalSheet .../> : null}` 会让程序化关闭路径不再向 `AdaptiveModalSheet` 传入 `visible=false`，从而绕过 `useIsolatedBottomSheetVisibility` / `visibility-tracker` 的 dismiss phase。
   - Resolution: fixed。最终实现恢复为始终挂载 compact `AdaptiveModalSheet`，并在 compact row/workspace navigation 路径中先 `setOpen(false)`，下一帧再执行 navigation。这样 web compact 能消除残留，同时保留 native Gorhom dismiss lifecycle。
   - Evidence: `status-bar-running-sessions.test.tsx` 新增顺序断言，验证 sheet 先关闭、下一帧才调用 agent/workspace navigation；`npm run test:e2e --workspace=@getpaseo/app -- status-bar-running-sessions.spec.ts` 复跑 2 passed。

2. Checklist / QA 对 native compact 覆盖表述偏满。
   - Reviewer 指出 S3/S4/C4 原本标为 done/passed，但 QA 同时承认真实 iOS/Android hardware back、home indicator safe area、Android/iOS Gorhom lifecycle 未覆盖。
   - Resolution: fixed。Checklist 将 S3/S4 改为 `done-with-gap`，C4 改为 `passed-with-gap`；QA/evidence/acceptance 保留 native compact 设备覆盖 residual risk。

### nit

1. 组件测试 i18n mock 返回 key，copy 渲染信号比真实 English 文案弱。
   - Resolution: accepted as non-blocking。`resources.test.ts` 覆盖 key parity 和关键 English source strings；组件测试保留 key mock 以聚焦状态流和 interaction。后续若状态栏 copy 继续扩张，可把 test mock 改为 English resource-backed mock。

## 3. Residual Risk

- Native compact 真机/模拟器验证仍未自动化覆盖：hardware back、home indicator safe area、Android/iOS Gorhom bottom sheet lifecycle、pan close 和 route change 后 backdrop 是否残留。该项已在 checklist 与 QA 中显式标为 gap。

## 4. Verdict

passed after fixes。
