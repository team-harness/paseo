---
doc_type: approval-report
unit: 2026-07-14-sidebar-duplicate-project-workspaces
status: approved
reason: review-authorization
created_at: 2026-07-15
---

# Approval Report

## Decision History

- 2026-07-15：owner 确认采用方案 A。
- 2026-07-15：实现经四轮独立 review 收口，最终无 blocking/important findings。
- 2026-07-15：owner 授权直接清理重复数据；已完成备份并通过 daemon RPC 软归档 17 个重复 workspace 及其 reviewer Agent。
- 2026-07-15：owner 要求更新 `changes-by-me.md` 后 commit 并 push，视为确认源码修复与数据清理完成。

## Decision Needed

已确认：源码修复与重复数据清理完成，并授权 scoped commit 与 push。生产 daemon 更新/重启不在本次授权内。

## Why Now

源码、协议 gate、定向测试、独立 review 与在线数据清理均已收口；当前只剩 owner 最终确认，以及是否另行授权更新/重启生产 daemon。

## Context

- `/Users/wyatt/work/cs-agent` 原有 18 条同 cwd 活跃 workspace；清理后 daemon 实时 API 只返回 canonical 1 条，17 条重复记录已软归档。
- daemon metrics 中每批 `workspace.create.request` 数量与 `create_agent_request` 数量一致。
- `paseo run` 的既定语义是：显式/ambient workspace 时复用；真正的裸 run 新建独立 workspace。
- provider 进程已有 `PASEO_AGENT_ID`，可以用它恢复调用者 Agent 的 `workspaceId`。

## Options

1. **方案 A（推荐）**：CLI 从 `PASEO_AGENT_ID` 继承调用者 workspace；收紧 Task Agent CLI 回退；移除按 cwd 全量合并的旧迁移；当前本机数据在获得 daemon 停止许可后定点清理。
2. **方案 B**：只修 CLI 继承，保留旧迁移自动清理。改动较小，但会误合并合法的同 cwd 多 workspace。
3. **方案 C**：所有裸 run 都按 cwd 复用。表面最直接，但破坏明确的 CLI 和 workspace multiplicity 产品契约。

## Recommendation

选择方案 A。它只在能证明当前调用者 Agent 身份时复用 workspace，不改变外部终端裸 run 和显式新 workspace/worktree 的行为。

## Risks And Tradeoffs

- CLI 需要一次父 Agent 查询；失效的 `PASEO_AGENT_ID` 应显式失败。
- 新行为通过 optional `server_info.features.agentWorkspaceInheritance` gate；旧 daemon 必须更新，不提供降级路径。
- 删除旧迁移后，不再用不可靠的 cwd 等价关系自动修改所有用户数据。
- 17 条重复记录已通过在线 RPC 软归档；对应 reviewer Agent 保留在 Archive，没有重关联到 canonical workspace。

## Non-Automatic Actions

本次数据清理没有停止或重启端口 `6767` 的 daemon，也没有直接编辑 `~/.paseo` JSON。仍未 commit、push、打包或发布。

## After You Answer

完成 scoped commit 与 push 后，本 issue 工作流闭环。生产 daemon/CLI 更新、端口 `6767` 重启及修复版真实批量 Task Agent 验收仍需另行授权。
