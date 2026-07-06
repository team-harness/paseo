---
doc_type: feature-review
feature: 2026-07-06-app-status-summary-store
status: passed
reviewer: subagent
reviewed: 2026-07-06
round: 1
---

# app-status-summary-store 代码审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-design.md`
- Checklist: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-checklist.yaml`
- Evidence pack: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-evidence-pack.md`
- Gate results: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-scope-gate.json`
- DoD results: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-dod-results.json`
- Implementation evidence: 当前工作区 diff、fresh DoD runner evidence、Paseo reviewer agent 输出和本地事实核验。
- Diff basis: `packages/app/src/status-summary/*`、`packages/app/src/contexts/session-context.tsx`、`packages/app/src/contexts/session-context.service-status.test.ts` 和本 feature 产物。

### Independent Review

- Detection: Paseo MCP 可用，独立 Paseo subagent 已完成。
- Reviewer agent: `921fd688-5dfb-4ebc-aa13-96b56b976eb3`
- Lifecycle: review 结果已消费；agent 已通过 Paseo MCP `archive_agent` 成功归档。
- Scope: 只读审查 `packages/app/src/status-summary/*` 与 `SessionProvider` 接入，未修改文件。
- Merge policy: reviewer 结论逐条本地核验；有效问题已修或记录为 residual risk。

## 2. Diff Summary

- 新增 `packages/app/src/status-summary/`：query/cache helper、push apply、view model、hooks 和目标测试。
- 修改 `packages/app/src/contexts/session-context.tsx`：status summary refresh 和 `status.summary.updated` push subscription。
- 修改 `packages/app/src/contexts/session-context.service-status.test.ts`：覆盖无 observer 的 refresh helper 与 push helper 共享 cache key。
- 新增本 feature scope gate、DoD、evidence pack、review/QA/acceptance 产物。
- 未实现 UI/shell/navigation，未调用 provider usage API，未从旧 RPC 拼 summary。

## 3. Findings

### blocking

- none

### important

- none

### resolved

- REV-001 `refreshStatusSummary()` 原先可能受 `staleTime: Infinity` 影响，只返回 fresh cache 而不真正 refetch。已改为先 exact `invalidateQueries` 再 `fetchQuery`，并用二次 refresh 测试证明会调用 client 两次。
- REV-002 reviewer 担心 `serverInfo` 初次到达前 refresh 被跳过且不会再触发。经本地核验，`supportsStatusSummary` 是 session store selector；`serverInfo.features.statusSummary` 写入后会改变 `refreshHostStatusSummary` callback identity，依赖该 callback 的 effect 会再次执行，因此当前实现已覆盖初连时序。
- REV-003 offline/unsupported 状态原先不携带 previous summary。已修为 disabled offline/unsupported 保留 `previousSummary`，view model 透传，测试覆盖。
- REV-004 “get 失败后收到 push” 的设计约束原先缺少显式测试。已补 `buildStatusSummaryQueryState` data 优先于 error 的测试，保证 push snapshot 不被旧 error 遮住。

### nit

- [ ] REV-005 `refreshStatusSummary` 是低层 helper，依赖调用者先检查 `shouldRefreshStatusSummary`。当前所有 production 调用满足该约束，后续若增加新调用点应沿用同一 predicate。
- [ ] REV-006 多个测试文件各自定义小型 `summary()` factory。重复可接受，避免为了测试夹具引入额外 shared indirection。

## 4. Test And QA Focus

- QA 必须重点复核：query/view model/push/session-context 目标测试、`npm run typecheck`、`npm run lint`、`npm run format:check`。
- Evidence pack residual risks / gate warnings：scope gate、DoD runner、evidence pack 均 passed 且无 warning。
- 已补强测试：forced refresh with infinite stale time、offline previous summary、push-after-error state precedence。
- 不能靠 review 完全确认的点：真实 app resume 与多 host client 并发下的 refresh cadence；后续 shell UI 需通过截图/手工路径验证 copy 和布局。

## 5. Residual Risk

- `SessionProvider` 仍是大型消息编排文件；本 feature 只增加 transport wiring，未进一步拆分。
- offline/unsupported view model 现在保留 previous summary，但后续 UI 必须清楚表达非实时状态，避免把 cached data 误导为 live。
- `unsupported` 是 feature gate 顶层状态；后续 shell 可以选择隐藏或提示升级，但不能 fan out 旧 RPC。

## 6. Verdict

- Status: passed
- Next: 进入 QA 和 acceptance。
