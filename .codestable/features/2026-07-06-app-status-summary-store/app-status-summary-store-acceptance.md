---
doc_type: feature-acceptance
feature: 2026-07-06-app-status-summary-store
status: passed
accepted: 2026-07-06
round: 1
---

# app-status-summary-store 验收报告

## 1. 接口契约核对

- [x] app 通过 `client.getStatusSummary()` 读取 `HostStatusSummaryPayload`。
- [x] `status.summary.updated` push 作为完整 snapshot replace React Query cache。
- [x] capability gate 只读 `server_info.features.statusSummary === true`。
- [x] query key 为 `["statusSummary", serverId]`，host-scoped cache 隔离。
- [x] `staleTime` 为 `Infinity`，freshness 来自 push 与 explicit refresh。

## 2. 行为与决策核对

- [x] 新增 `packages/app/src/status-summary/`，集中 query、push、view model 和 hooks。
- [x] `SessionProvider` 在初连、serverInfo capability 到达、offline→online 和 app resume 时触发 refresh。
- [x] `refreshStatusSummary()` 即使 cache fresh 也会 refetch。
- [x] unsupported 旧 daemon 不 fan out 旧 RPC，不调用 provider usage，不从 session/timeline 拼 summary。
- [x] offline/error/unsupported/loading 状态保留 previous summary 供后续 UI 降级显示。
- [x] 本 feature 不渲染状态栏、不改 host route layout、不实现导航动作。

## 3. 验收场景核对

- [x] supported host fetch and cache：`use-status-summary.test.ts` 通过。
- [x] unsupported host 不 fetch：`use-status-summary.test.ts` 通过。
- [x] reconnect/app resume explicit refresh 不依赖 observer：`session-context.service-status.test.ts` 和 query helper tests 通过。
- [x] push replace 与 serverId 隔离：`push.test.ts` 通过。
- [x] get error 后 push data 优先：`use-status-summary.test.ts` 通过。
- [x] view model 输出 primaryRows、runningAgents、needsAttentionAgents、recentlyCompletedAgents：`view-model.test.ts` 通过。
- [x] Review 和 QA 报告均 passed，residual risk 不承载核心验收缺口。

## 4. roadmap 回写

- [x] `.codestable/roadmap/global-status-bar/global-status-bar-items.yaml` 对应 item 从 `in-progress` 改为 `done`。
- [x] `.codestable/roadmap/global-status-bar/global-status-bar-roadmap.md` 第 5 节对应条目同步为 `状态：done`，`对应 feature：2026-07-06-app-status-summary-store`。
- [x] `.codestable/roadmap/global-status-bar/goal-state.yaml` 当前 feature index 前移到 `3`，本 feature 状态为 `accepted`。

## 5. 最终审计

- Evidence sources：`app-status-summary-store-evidence-pack.md` / `app-status-summary-store-dod-results.json` / `app-status-summary-store-scope-gate.json`
- 聚合命令：status-summary 目标测试、SessionProvider 目标测试、`npm run typecheck`、`npm run lint`、`npm run format:check` 均 exit 0。
- 独立审查：Paseo reviewer agent `921fd688-5dfb-4ebc-aa13-96b56b976eb3` 已完成并归档。
- 交付物复核：app store/query/push/view model/feature gate/roadmap 均已落盘；docs 无新增长期 gotcha。
- 结论：通过。
