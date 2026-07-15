# Personal Change Ledger

本文件记录本地维护者在 `team-harness/paseo` fork 上完成并验证的定点改动。它补充
`changes-by-cs.md` 的长期上游同步视角，不替代 Git 历史或发布说明。

## 2026-07-15

### Task Agent workspace 继承与重复侧边栏数据清理

**结果**：Paseo-managed Agent 内的裸 `paseo run` 现在仅在 daemon 宣告
`server_info.features.agentWorkspaceInheritance` 时，通过 `PASEO_AGENT_ID` 恢复调用者 Agent，
并确认其 workspace 仍 active 后复用。旧 daemon 明确提示更新 host；外部裸 run、显式
workspace、worktree 与跨 host 行为保持不变。

**数据处理**：清理前 `/Users/wyatt/work/cs-agent` 有 18 条 active workspace。备份完成后，
通过 daemon `archiveWorkspace` RPC 软归档 17 条重复 workspace 及其 reviewer Agent；历史保留在
Archive，canonical `wks_35e47cc23645bab5` 与其中运行的 Agent 未受影响。备份位于
`/Users/wyatt/.paseo/backups/sidebar-duplicate-cleanup-20260715-194221`。

**关键改动**：

- CLI current-Agent workspace 继承、host/错误/归档边界与回归测试。
- optional server capability 及 daemon 宣告，保留协议双向解析兼容。
- 删除按 cwd 合并所有 workspace 的危险启动迁移，保留合法 same-cwd multiplicity。
- 收紧 Paseo Task Agent CLI fallback，并同步生命周期文档和 CodeStable issue 工件。

**验证**：`npm run build:server`；6 个定向 Vitest 文件共 43 项；目标 server-info E2E；
`npm run typecheck`；定向 lint；第四轮独立 review（无 blocking/important）；生产 registry、daemon
实时 API 与 health 三层清理验收。

**未包含**：生产 daemon/桌面应用尚未更新或重启；源码提交不会自动替换当前运行版本。
