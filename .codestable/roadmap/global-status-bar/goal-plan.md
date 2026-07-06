---
doc_type: roadmap-goal-plan
roadmap: global-status-bar
status: ready-to-dispatch
created: 2026-07-06
---

# global-status-bar Goal Plan

## 1. Scope

- Roadmap: `.codestable/roadmap/global-status-bar/global-status-bar-roadmap.md`
- Items: `.codestable/roadmap/global-status-bar/global-status-bar-items.yaml`
- Goal state: `.codestable/roadmap/global-status-bar/goal-state.yaml`
- Goal protocol: `.codestable/roadmap/global-status-bar/goal-protocol.md`

目标：按已批准的 6 个 feature design，实现 host-scoped 全局状态栏：先建立实际 agent usage ledger，再暴露 status summary 协议和 app store，最后在 host 底部渲染状态栏、运行 session 面板与收口验证。

## 2. Feature Execution Order

| #   | Feature                           | Type       | One-line deliverable                                                                          |
| --- | --------------------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| 1   | `usage-history-persistence`       | functional | daemon usage ledger 可持久化、去重并查询 lifetime/today totals。                              |
| 2   | `status-summary-protocol`         | functional | daemon/client/protocol 提供 gated `status.summary` get + push 和 `HostStatusSummaryPayload`。 |
| 3   | `app-status-summary-store`        | functional | app 侧 host summary cache、push/reconnect refresh、view model 和 gate。                       |
| 4   | `global-status-bar-shell`         | mixed      | host layout 底部 participating footer 状态栏、bottom chrome context、display-only states。    |
| 5   | `status-bar-running-sessions-nav` | functional | 状态栏 activity trigger、desktop/compact details panel 和 agent/workspace navigation。        |
| 6   | `status-bar-polish-hardening`     | mixed      | 状态/布局/交互/a11y/i18n/scope/docs 的最终证据矩阵和收口。                                    |

## 3. Roadmap Core Acceptance Paths

- Server/API: usage events across provider-like fixtures produce persisted lifetime/today totals across restart/day/archive.
- Protocol/client: supported daemon exposes `server_info.features.statusSummary`, `getStatusSummary()` returns usage/activity summary, and `status.summary.updated` push updates clients.
- App data: host-scoped app cache refreshes on initial connect/reconnect/resume and does not call old daemon fallback when unsupported.
- UI: under `/h/[serverId]/*`, workspace/agent/sessions/settings show a bottom status bar; root/global routes hide it.
- UI interaction: running/attention/recent session snapshots open desktop panel or compact sheet, close on dismiss/route/nav, and navigate via existing helpers.
- Mobile/layout: compact safe area, keyboard, composer, autocomplete/command popover, and bottom sheet coexist without duplicate inset or obstruction.

## 4. Key Assumptions

- Designs in all six feature directories are `approved` and design-review reports are `passed`.
- Goal driver must execute features in dependency order; hardening starts only after store/shell/nav are actually implemented.
- No full local test suite is run. Use target tests and final aggregate commands; broad verification belongs to CI unless explicitly requested.
- Old daemon fallback is out of scope. Capability gate controls availability; missing gate means unsupported/hidden UI.
- Provider plan usage/quota remains separate and is not fetched by status summary.

## 5. Top Risks And Mitigations

1. Usage correctness across providers and turns
   - Mitigation: implement ledger first with per-provider fixtures and turn-scoped basis; status summary must read ledger totals rather than live lastUsage.
2. Bottom status bar breaks composer safe area/keyboard behavior
   - Mitigation: shell feature owns bottom chrome context; hardening requires compact keyboard/safe-area evidence.
3. Scope creep into old RPC/provider usage/lifecycle actions
   - Mitigation: every feature has scope guards; final hardening re-runs grep and documents manual classifications.

## 6. Mandatory Command Set

Feature-specific commands are listed in `goal-features/*.md` from each approved checklist. Common commands:

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`

Do not run full `npm run test` or full Playwright. Use only target Vitest files and targeted Playwright/Maestro flows specified by the current feature.

## 7. Final Aggregate Commands

Run near final audit after all feature acceptances:

- `npm run build:client`
- `npm run build:server`
- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `python3 .codestable/tools/codestable-goal-consistency-gate.py --roadmap .codestable/roadmap/global-status-bar`

Targeted UI/e2e commands from hardening are final aggregate evidence when their specs are added. If a non-core targeted Playwright/Maestro command is skipped because no spec/flow was introduced, audit must record why.

## 8. Preflight Strategy

- Before each feature implementation, read its approved design/checklist and run any S0/precondition checks.
- If target test files do not exist because a predecessor has not landed, stop at that feature and repair predecessor state; do not mark file-not-found as feature failure.
- If typecheck fails due to stale cross-package declarations, follow repo rule and rebuild the owning stack before patching code.

## 9. DoD Policy

- Each feature must complete implementation, code review, QA, acceptance.
- Checklist `steps` move to `done` during implementation; checklist `checks` move to `passed` only during acceptance.
- Review, QA, and acceptance reports must be written in the feature directory.
- Feature is not accepted while review has unresolved blocking or QA has failed/blocked items.

## 10. Gate Policy

- Runtime gate rules live in `.codestable/roadmap/global-status-bar/goal-protocol-gates.md`.
- `scope-gate`, `dod-runner`, `evidence-pack`, consistency gates must be run when required by protocol. If scripts are missing, run CodeStable preflight/runtime sync rather than faking results.
- Validation tools missing or unavailable may be repaired only by installing/restoring real dependencies or runner config; do not add same-name shims or fake output.

## 11. Provider Policy

- Use Paseo/Task agents for independent code review when available.
- Provider unavailable is recorded as fallback, not automatically blocking unless it hides core evidence.
- Provider warnings must be interpreted by review/QA/audit.
- archguard/meta-cc unavailable is recorded with fallback; it does not block by itself.

## 12. Final Audit Deliverables

Final audit will verify:

- `goal-state.yaml` all features accepted and `current_feature_index` complete.
- `global-status-bar-items.yaml` all included items are `done` or justified `dropped`.
- Each feature has review/QA/acceptance reports with passing status.
- Each checklist has steps `done` and checks `passed`.
- Final aggregate commands and roadmap core acceptance paths have evidence.
- Docs/architecture/compound writebacks are completed or explicitly not applicable.
- Workspace has no unclassified debug output, TODO/FIXME, temporary screenshots, fake runner shims, or unrelated changes.
