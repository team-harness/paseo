---
doc_type: feature-qa
feature: 2026-07-08-status-bar-session-pins
status: passed
tested: 2026-07-08
round: 1
---

# status-bar-session-pins QA 报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-08-status-bar-session-pins/status-bar-session-pins-design.md`
- Checklist: `.codestable/features/2026-07-08-status-bar-session-pins/status-bar-session-pins-checklist.yaml`
- Review: `.codestable/features/2026-07-08-status-bar-session-pins/status-bar-session-pins-review.md`
- Feature type: functional / protocol / server persistence / app UI。
- Core evidence gate: host-owned pin store、status summary/RPC/capability、sessions/history row toggle、History 旁 Pin list、scope guards。

## 2. Verification Matrix

| ID     | 来源         | 核心性     | 场景 / 风险                                                                               | 证据类型  | 命令或动作                                                                                                                                                                                                                             | 结果 |
| ------ | ------------ | ---------- | ----------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| QA-001 | S1/C1/C2/C8  | core       | protocol schema、host store、损坏文件回退、原子写、并发 mutation                          | unit      | `npx vitest run packages/protocol/src/messages.test.ts --bail=1`; `npx vitest run packages/server/src/server/messages.test.ts --bail=1`; `npx vitest run packages/server/src/server/status-summary/session-pin-store.test.ts --bail=1` | pass |
| QA-002 | S2/C6        | core       | Session RPC 分发、summary broadcast、client RPC                                           | unit      | `npx vitest run packages/server/src/server/session.test.ts --bail=1`; `npx vitest run packages/client/src/daemon-client.test.ts --bail=1`                                                                                              | pass |
| QA-003 | S3/C3        | core       | `server_info.features.statusBarSessionPins`、app capability 单点、summary pins view model | unit      | `npx vitest run packages/protocol/src/messages.test.ts --bail=1`; `npx vitest run packages/app/src/status-summary/view-model.test.ts --bail=1`                                                                                         | pass |
| QA-004 | S4/S5/C4/C5  | core       | sessions/history Pin toggle、pending、防行导航、Pin list、`workspaceId: null` 导航        | component | `npx vitest run packages/app/src/status-summary/status-bar-running-sessions.test.tsx --bail=1`                                                                                                                                         | pass |
| QA-005 | i18n         | supporting | Pin 文案 locale shape                                                                     | unit      | `npx vitest run packages/app/src/i18n/resources.test.ts --bail=1`                                                                                                                                                                      | pass |
| QA-006 | S6/C7/C9     | supporting | app-local store / lifecycle / direct route / COMPAT 占位 scope guard                      | grep      | checklist CMD-009..CMD-011                                                                                                                                                                                                             | pass |
| QA-007 | repo quality | supporting | 类型、lint、格式                                                                          | command   | `npm run typecheck`; `npm run lint`; `npm run format:check`                                                                                                                                                                            | pass |

## 3. Command Results

- `npx vitest run packages/protocol/src/messages.test.ts --bail=1` → exit 0：21 tests passed。
- `npx vitest run packages/server/src/server/messages.test.ts --bail=1` → exit 0：8 tests passed。
- `npx vitest run packages/server/src/server/status-summary/session-pin-store.test.ts --bail=1` → exit 0：5 tests passed。
- `npx vitest run packages/server/src/server/session.test.ts --bail=1` → exit 0：132 tests passed。
- `npx vitest run packages/client/src/daemon-client.test.ts --bail=1` → exit 0：100 tests passed。
- `npx vitest run packages/app/src/status-summary/status-bar-running-sessions.test.tsx --bail=1` → exit 0：17 tests passed。
- `npx vitest run packages/app/src/i18n/resources.test.ts --bail=1` → exit 0：33 tests passed。
- `npm run build:client` → exit 0：protocol/client declarations refreshed for app typecheck。
- `npm run typecheck` → exit 0。
- `npm run lint` → exit 0：0 warnings / 0 errors。
- `npm run format:check` → exit 0。
- `! rg "AsyncStorage|pinned-tab-targets|usePinnedTargetsStore" packages/app/src/status-summary` → exit 0。
- `! rg "router\\.|buildHostAgentDetailRoute|buildHostWorkspaceRoute|archiveAgent|cancelAgent|deleteAgent|stopAgent" packages/app/src/status-summary packages/server/src/server/status-summary` → exit 0。
- `! rg "COMPAT\\(statusBarSessionPins\\).*v0\\.1\\.X" packages/app/src packages/server/src packages/protocol/src` → exit 0。

## 4. Scenario Results

- [x] Host-owned persistence：pass。`SessionPinStore` writes `$PASEO_HOME/status-summary/session-pins.json` via atomic JSON write; corrupt file falls back to empty list.
- [x] Concurrent mutation safety：pass。`mutationQueue` serializes store mutations; test covers concurrent pin of two agents and reload from disk.
- [x] Summary/RPC broadcast：pass。server session test covers set RPC, summary update, and correlated response.
- [x] App capability gate：pass。view model exposes `canUseStatusBarSessionPins`; old host tests hide pin controls.
- [x] Row toggle：pass。sessions/history Pin buttons call host mutation and do not call navigation spies.
- [x] Pinned list：pass。History 旁 Pin trigger appears with pins, opens list, and navigates with `workspaceId: null`.
- [x] Scope guard：pass。No app-local session pin, no direct router route, no lifecycle mutation.

## 5. Findings

### fixed during QA/review

- Review blocking: store read-modify-write was not serialized. Fixed with mutation queue and persist-before-commit semantics.
- OCR medium: fr/pt-BR Pin strings were English fallback. Fixed with localized strings.
- OCR medium: persist failure could leave in-memory state mutated. Fixed by committing memory only after successful persist.

### failed

none。

### blocked

none。

### residual-risk

- 真机 native compact sheet 未跑 Maestro；component test 覆盖 compact state flow，web DOM test 覆盖 click/navigation behavior。
- Store 并发 test 使用真实 fs 调度；后续可通过 injectable persist barrier 增强旧实现红灯确定性。

## 6. Cleanliness

- Debug output: pass。
- Temporary TODO/FIXME/XXX: pass。
- Commented-out code: pass。
- Unused imports: pass。
- Out-of-scope app-local/lifecycle/router mutations: pass。
- COMPAT version placeholders for `statusBarSessionPins`: pass。

## 7. Verdict

- Status: passed。
- Acceptance: 可进入 feature acceptance。
