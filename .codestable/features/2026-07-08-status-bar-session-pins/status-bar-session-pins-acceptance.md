---
doc_type: feature-acceptance
feature: 2026-07-08-status-bar-session-pins
status: passed
accepted: 2026-07-08
round: 1
---

# status-bar-session-pins 验收报告

## 1. 接口契约核对

- [x] `HostStatusSummaryPayloadSchema` additive optional `pinnedSessions?: StatusPinnedSession[]`。
- [x] 新 RPC 使用 dotted namespace：`status.session_pins.set.request` / `status.session_pins.set.response`。
- [x] `server_info.features.statusBarSessionPins` 暴露能力，app 通过 `useGlobalStatusBarView` 单点读取 capability。
- [x] `DaemonClient.setStatusSessionPin()` 发送 set RPC，requestId 可由 client 生成。
- [x] daemon bootstrap 创建一个 `SessionPinStore`，注入同一个 `StatusSummaryService` mutation/summary 链路。

## 2. 行为与决策核对

- [x] Pin 是 host/daemon 本地偏好，持久化在 `$PASEO_HOME/status-summary/session-pins.json`。
- [x] app 不使用 AsyncStorage / `workspace-pins` 存 session pin。
- [x] Pin 不写入 agent record，不改变 archive/delete/stop/cancel 生命周期。
- [x] mutation 成功后触发 `status.summary.updated`，多客户端通过现有 status summary push/query 路径同步。
- [x] sessions/history row Pin toggle 是独立 icon button，不触发行主导航。
- [x] History 旁新增 Pin trigger/list；缺 `workspaceId` 时仍按 `agentId` 导航。
- [x] 旧 host 无 capability 时不显示可操作 Pin，也不调用 set RPC。

## 3. 验收场景核对

- [x] 客户端在 running sessions 列表 Pin 某行 → host mutation 被调用，row navigation 未触发。
- [x] 客户端在 history 列表 Pin 某行 → host mutation 被调用，row navigation 未触发。
- [x] daemon restart 持久化路径由 store reload 单测覆盖；summary 聚合由 service test 覆盖。
- [x] 同一 agent 按 `agentId` 去重；store set 会替换同 agent entry 并保留原 `pinnedAt`。
- [x] stale pinned target 可显示 fallback title/provider/updatedAt，并以 `workspaceId: null` 导航。
- [x] 多客户端一致性链路：Session RPC → store → summary service emit → all Session subscribers。

## 4. 术语一致性

- UI label 使用 `Pin` / `Pinned sessions`；代码层术语使用 `StatusPinnedSession` / `SessionPinStore`。
- `workspaceId` 只作为导航 hint，不从 `cwd` 推导 ownership。
- `workspace-pins` 仍是 app-local workspace tab launcher 域，未复用到本 feature。

## 5. 领域影响盘点

- 新增 server-side store 已记录在 `docs/data-model.md`。
- 新 protocol 字段/RPC 保持 additive；schema 未使用 transform/preprocess/catch。
- 新 feature gate 使用真实版本号 `v0.1.105`，未保留 `v0.1.X` 占位。

## 6. requirement delta / clarification 回写

无新的 requirement delta。用户确认的核心假设“Pin 是本机 app 的 host/daemon 本地偏好，不跨设备同步，不是 app 缓存”已落入 design、store 和 data model。

## 7. roadmap 回写

本 feature 当前是独立 CodeStable feature 目录，不回写 roadmap 条目。

## 8. attention.md 候选盘点

- 候选：新 host-owned JSON preference store 若有 read-modify-write mutation，应像 usage ledger/agent storage 一样串行化。该知识已在 review learning 中记录；后续若再次新增 store，可沉淀到 `docs/data-model.md` 的 store surface rules。

## 9. 遗留

- 非 blocking UX nit：Pin mutation 失败目前只复位 pending，不展示 toast。
- 非 blocking test gap：真机 native compact sheet 未跑 Maestro。
- 非 blocking test hardening：store 并发测试可后续通过 injectable persist barrier 增强确定性。

## 10. 最终审计

- Re-verified:
  - `npm run build:client`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run format:check`
  - `npx vitest run packages/protocol/src/messages.test.ts --bail=1`
  - `npx vitest run packages/server/src/server/messages.test.ts --bail=1`
  - `npx vitest run packages/server/src/server/status-summary/session-pin-store.test.ts --bail=1`
  - `npx vitest run packages/server/src/server/session.test.ts --bail=1`
  - `npx vitest run packages/client/src/daemon-client.test.ts --bail=1`
  - `npx vitest run packages/app/src/status-summary/status-bar-running-sessions.test.tsx --bail=1`
  - `npx vitest run packages/app/src/i18n/resources.test.ts --bail=1`
  - checklist CMD-009/CMD-010/CMD-011 scope grep
- Independent review:
  - OCR completed; 3 medium findings fixed or dispositioned.
  - Native Task agent initial review found 1 blocking; fixed.
  - Paseo subagent review independently found same store concurrency issue; fixed.
  - Native Task agent review-fix pass returned no blocking.
- Verdict: passed。
