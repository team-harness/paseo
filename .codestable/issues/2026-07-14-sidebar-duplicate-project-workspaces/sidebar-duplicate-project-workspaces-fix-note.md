---
doc_type: issue-fix
issue: 2026-07-14-sidebar-duplicate-project-workspaces
status: confirmed
path: standard
fix_date: 2026-07-15
related:
  - sidebar-duplicate-project-workspaces-report.md
  - sidebar-duplicate-project-workspaces-analysis.md
tags: [sidebar, workspace, task-agent, cli]
---

# Task Agent 产生重复 workspace 条目修复记录

## 1. 根因摘要

Task Agent 适配器要求 reviewer 使用调用者当前 workspace，但 MCP 不可用时实际执行了 Agent 内裸 `paseo run`。`packages/cli/src/commands/agent/run.ts:resolveRunWorkspace` 只识别显式 `--workspace` 和 `PASEO_WORKSPACE_ID`，没有利用 provider 进程已有的 `PASEO_AGENT_ID` 恢复父 Agent 的 `workspaceId`，因此每个 reviewer 都合法地走入 `workspace.create.request`。

父 Agent 的本地 Codex 会话记录给出直接证据：批量命令没有 `--workspace`/`--host`，每次 stderr 都输出 `Created workspace ...`；生产 registry 最初形成 17 条同 cwd 活跃记录，修复期间旧生产 daemon 又由一轮 Task Agent 创建第 18 条。

旧修复新增的 `consolidateDuplicateWorkspaces` 又把所有同 cwd workspace 视为重复，违反 Paseo 明确支持的 same-directory workspace multiplicity，不能作为通用数据修复保留。

## 2. 实际采用方案

- `resolveRunWorkspace` 在未显式选择 workspace/worktree/host、且存在 `PASEO_AGENT_ID` 时，通过 daemon `fetchAgent` 读取父 Agent 的 `workspaceId` 并复用。
- 继承要求 `server_info.features.agentWorkspaceInheritance`；旧 daemon 返回 `CURRENT_AGENT_WORKSPACE_UNSUPPORTED` 并提示更新 host，不走降级 RPC 路径。
- 父 Agent 查询失败、已归档、没有 workspace，或 workspace/project 不再 active 时，统一返回 `CURRENT_AGENT_WORKSPACE_UNAVAILABLE`，不静默创建新 workspace。
- capability 存在时，CLI 用分页 `fetchWorkspaces` 确认 exact active workspace ID，不把 `fetchAgent.project` 的存在误当作未归档证明。
- 显式 `--workspace`、ambient `PASEO_WORKSPACE_ID`、`--worktree`、`--host`/`PASEO_HOST` 跨 daemon 调用和外部裸 run 的既有语义不变。
- Task Agent skill 的 CLI 回退要求继承父 workspace、写入真实 parent label，并在 stderr 出现 `Created workspace` 时立即阻断后续批次。
- 删除按 cwd 全量合并的迁移、测试和 bootstrap 调用；legacy cwd-only Agent backfill 与 create-agent fallback 保持原有兼容行为。

## 3. 改动文件清单

- `packages/cli/src/commands/agent/run.ts`
- `packages/cli/src/commands/agent/run.test.ts`
- `packages/server/src/server/workspace-registry-bootstrap.ts`
- `packages/server/src/server/workspace-registry-bootstrap.test.ts`
- 删除 `packages/server/src/server/migrations/consolidate-duplicate-workspaces.migration.ts`
- 删除 `packages/server/src/server/migrations/consolidate-duplicate-workspaces.migration.test.ts`
- `skills/paseo/SKILL.md`
- `docs/agent-lifecycle.md`
- `changes-by-cs.md`
- 本 issue 的 report、analysis、approval 与 fix-note

## 4. 验证结果

- 红灯验证：新增 CLI 测试最初以 `resolveRunWorkspace is not a function` 失败，证明旧实现缺少当前 Agent workspace 解析。
- `npm run build:server`：通过；server 依赖、server 与 CLI 全部重建，已删除迁移不再残留于生成产物。
- `npx vitest run packages/cli/src/commands/agent/run.test.ts packages/protocol/src/messages.server-info.test.ts packages/server/src/server/workspace-registry-bootstrap.test.ts packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.test.ts packages/server/src/server/cli-run-workspace-precedence.e2e.test.ts packages/server/src/server/workspace-same-cwd-isolation.e2e.test.ts --bail=1`：6 个文件、43 个测试通过。
- `npx vitest run packages/server/src/server/daemon-client.e2e.test.ts -t "receives server_info on websocket connect" --bail=1`：目标 server_info E2E 通过，确认 daemon 实际发送 capability；同文件全跑在范围外 provider mock 缺少 `fetchCatalog` 处失败，不属于本修复。
- `npm run typecheck`：全部 workspace 通过。
- `npm run lint -- packages/cli/src/commands/agent/run.ts packages/cli/src/commands/agent/run.test.ts packages/server/src/server/workspace-registry-bootstrap.ts packages/server/src/server/workspace-registry-bootstrap.test.ts`：0 warnings、0 errors。
- capability gate 加入前，已构建 CLI 对当前生产 daemon 的只读解析命中 `wks_35e47cc23645bab5` 且没有调用 workspace create；最终实现会把尚未更新、未宣告 capability 的生产 daemon 明确阻断为 `CURRENT_AGENT_WORKSPACE_UNSUPPORTED`。
- 目标文件已通过 `npm run format:files -- ...`；复审收口后的 `git diff --check` 通过。
- 第四轮独立 full rereview：`blocking: none`、`important: none`，verdict `passed`；复审前后 Git 三类基线哈希一致，确认 reviewer 未写入。

## 5. 遗留事项

- 运行中的端口 `6767` 生产 daemon 与桌面应用尚未替换为本次构建；遵守项目规则，本轮没有重启它。
- owner 授权直接清理后，先备份到 `/Users/wyatt/.paseo/backups/sidebar-duplicate-cleanup-20260715-194221`，workspace registry 原件与备份 SHA-256 均为 `22b2f0a967473d7a7c20bb917964a9324fb046c52e91dd77a34af796eaa584a6`。
- 通过运行中 daemon 的正式 `archiveWorkspace` RPC 依次软归档 17 个重复 workspace；对应 17 个 reviewer Agent 一并进入 Archive，历史 JSON 保留但没有重关联到 canonical workspace。没有直接编辑 `~/.paseo` JSON，也没有停止或重启 daemon。
- 清理后磁盘 registry 与 daemon 实时 API 均只保留 canonical `wks_35e47cc23645bab5` 为 active；17 个重复 workspace 和 17 个受影响 Agent 均有 `archivedAt`。canonical 中运行的 Agent `241a549c-b7e8-4e8d-810d-7253b8c14f7f` 未受影响，daemon health 为 `ok`。
- 尚未做生产 UI 截图与修复版真实批量 Task Agent 验收。当前 daemon/CLI 仍是旧版本，在更新并重启前仍可能再次创建重复 workspace。
- 旧修复 `80bd2adfe` 的宽泛迁移已从源码撤销；其历史结论由本次 report、analysis 和 fix-note 取代。
