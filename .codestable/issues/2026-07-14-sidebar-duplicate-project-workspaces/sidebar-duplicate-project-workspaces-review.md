---
doc_type: issue-review
issue: 2026-07-14-sidebar-duplicate-project-workspaces
status: passed
reviewer: subagent
reviewed: 2026-07-15
round: 4
---

# 侧边栏重复 workspace 修复代码审查报告

## 1. Scope And Inputs

- Report: `sidebar-duplicate-project-workspaces-report.md`
- Analysis: `sidebar-duplicate-project-workspaces-analysis.md`
- Fix note: `sidebar-duplicate-project-workspaces-fix-note.md`
- Review mode: full-rereview after material production-code changes.
- Scoped implementation: CLI current-Agent workspace resolution、optional server capability、daemon capability announcement、危险 same-cwd 迁移撤销、Task Agent skill 与生命周期文档。
- Baseline dirty files: Claude provider thinking 改动、`.codestable/reference/**` runtime 同步、`.codegraph/**` 均不属于本 issue 实现 diff。

### Independent Review

- 独立 reviewer: `/root/independent_review`，严格只读。
- Round 2: 4 个 important，覆盖 `PASEO_HOST`、真实 `fetchAgent` rejection、悬空 workspaceId、skill stderr 模式。
- Round 3: 前述项关闭后新增 2 个 important，覆盖归档 workspace 与伪旧-daemon兼容路径。
- Round 4: full rereview，`blocking: none`、`important: none`，verdict `passed`。
- Read-only control: `verified-no-write`。复审前后 status、unstaged diff、staged diff SHA-256 完全一致：`8e987b9a8b13c1d9389cc7556531d05c06da90b3b411c7f39fc989b84bcd1e04`、`4def0b036a98a3ed8e421c9b852b864e3721a5abc373c496e89c66ab90e8f7fb`、`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。
- OCR lane: `skipped-scope-ambiguous`；工作区含范围外 dirty/untracked 路径，按协议使用独立 reviewer 加 scoped 本地行级复核。

## 2. Diff Summary

- CLI 仅在默认 daemon、存在 `PASEO_AGENT_ID` 且 daemon 宣告 `agentWorkspaceInheritance` 时继承。
- 当前 Agent 查询失败、已归档、缺少 workspace，或 exact workspace 不在 active descriptor 列表时显式失败，不创建记录。
- 旧 daemon 缺 capability 时返回 `CURRENT_AGENT_WORKSPACE_UNSUPPORTED` 与 update-host 指引，不拼 legacy RPC fallback。
- 外部裸 run、显式/ambient workspace、worktree 和跨 host 行为保持原契约。
- 删除按 cwd 合并全部 workspace 的启动迁移，保留合法 same-cwd workspace multiplicity。
- Skill 按继承/显式模式分别核对 stderr，并在 `Created workspace` 或 unsupported host 时阻断批次。

## 3. Findings

### blocking

none

### important

none

### nit

none

## 4. Focused Closure

- [x] REV-001：`PASEO_HOST` 与 `--host` 均禁止继承本地 Agent 身份，并有测试。
- [x] REV-002：`fetchAgent` rejection 统一转换为 `CURRENT_AGENT_WORKSPACE_UNAVAILABLE`。
- [x] REV-003：exact workspace 必须出现在分页 active workspace 列表，悬空或归档 ID 被拒绝。
- [x] REV-004：skill 分别校验 `Using current agent workspace` 与 `Using workspace`。
- [x] REV-005：CLI help 明确外部 bare run 仍创建 workspace。
- [x] REV-006：归档 Agent 直接拒绝，workspace/project 归档由 active descriptor 校验拒绝。
- [x] REV-007：新增 optional `server_info.features.agentWorkspaceInheritance` 单点 gate；旧 daemon 提示更新 host，不再声称不成立的分页兼容。

## 5. Test And QA Evidence

- `npm run build:server`：通过。
- 6 个定向 Vitest 文件、43 个测试：通过。
- `daemon-client.e2e.test.ts` 的目标 `receives server_info on websocket connect`：通过，确认 daemon 实际发送 capability。
- `npm run typecheck`：全部 workspace 通过。
- 8 个实现/测试文件定向 lint：0 warnings、0 errors。
- 旧生产 daemon 只读探针：稳定返回 `CURRENT_AGENT_WORKSPACE_UNSUPPORTED`；探针前后 `cs-agent` 活跃 workspace 数均为 18，没有创建第 19 条。
- `daemon-client.e2e.test.ts` 全文件另在范围外 provider mock 缺少 `fetchCatalog` 处失败；目标 server_info 用例独立通过。

## 6. Residual Risk

- Agent/workspace active 校验与 create-agent 之间存在客户端检查竞态；若恰在该窗口归档，server 仍可能接受旧 ID。独立 reviewer 判定不阻断本修复。
- 尚无完整 CLI→daemon 的 current-Agent inheritance E2E；现有 unit、protocol、server-info E2E 与只读生产探针覆盖各边界。
- 生产 daemon 尚未更新；17 条重复 workspace 与对应 reviewer Agent 已通过在线 RPC 软归档，daemon 实时 API 只剩 canonical 1 条 active。UI 截图与修复版真实批量 Task Agent 验收仍待执行。

## 7. Verdict

- Status: passed
- Blocking: none
- Important: none
- Next: 回到 `cs-issue` 最终 owner 确认；生产 daemon 更新/重启仍需独立明确授权。
