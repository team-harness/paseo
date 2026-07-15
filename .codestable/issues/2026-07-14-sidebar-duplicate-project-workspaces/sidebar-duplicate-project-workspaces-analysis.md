---
doc_type: issue-analysis
issue: 2026-07-14-sidebar-duplicate-project-workspaces
status: confirmed
root_cause_type: logic
related: [sidebar-duplicate-project-workspaces-report.md]
tags: [sidebar, workspace, task-agent, cli, environment]
---

# Task Agent 产生重复 workspace 条目根因分析

## 1. 问题定位

| 关键位置                                                                                    | 说明                                                                                                                                              |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills/paseo/SKILL.md:44-47,72-75`                                                         | Task Agent 契约要求使用调用者当前 workspace，但 MCP 不可用时允许 CLI 回退，没有约束 CLI 必须解析出当前 workspace。                                |
| `packages/server/src/server/agent/agent-manager.ts:4082-4093`                               | provider 启动环境只注入 `PASEO_AGENT_ID`，这足以定位调用者 Agent，但没有直接注入 workspace ID。                                                   |
| `packages/cli/src/commands/agent/run.ts:416-450`                                            | CLI 只读取显式 `--workspace` 或 `PASEO_WORKSPACE_ID`；两者都没有时，裸 run 会发送 `workspace.create.request`，这是同目录多 workspace 的既定语义。 |
| `packages/server/src/server/cli-run-workspace-precedence.e2e.test.ts:31-88`                 | 回归测试明确要求同 cwd 的两次裸 run 创建两个不同 workspace；按 ID 附着才不新增记录。                                                              |
| `packages/server/src/server/migrations/consolidate-duplicate-workspaces.migration.ts:20-73` | 旧修复按 cwd 合并所有活跃 workspace，与项目支持同 cwd 多 workspace 的领域模型冲突，会误归档合法 workspace。                                       |
| `~/.paseo/projects/workspaces.json` 与 `~/.paseo/daemon.log`                                | 清理前 `cs-agent` 有 18 条同 cwd 活跃记录；17 条新增记录按 Task Agent 批次生成，daemon 中每批 `workspace.create.request` 与 Agent 数量一致。      |

## 2. 失败路径还原

**正常路径**：Task Agent 使用 agent-scoped `create_agent` 的 `workspace: { kind: "current" }`；或者 CLI 根据当前 `PASEO_AGENT_ID` 查询父 Agent 的 `workspaceId`，再按该 ID 创建 Agent。两条路径都不发送 `workspace.create.request`，侧边栏 workspace 数量不变。

**失败路径**：Task Agent 在原生工具不可用时回退 CLI。父 Agent 的 provider 进程有 `PASEO_AGENT_ID`，但 `resolveRunWorkspace` 没有用它恢复父 Agent 的 workspace；环境中又没有 `PASEO_WORKSPACE_ID`，于是每次裸 run 都显式创建新 workspace，再把 reviewer Agent 绑定到新 ID。侧边栏按独立 workspace ID 正确渲染，因而每个 reviewer 增加一条。

**分叉点**：`packages/cli/src/commands/agent/run.ts:431-450` — 缺少显式/ambient workspace 时直接进入 `createWorkspace(directory)`，没有先利用已注入的 `PASEO_AGENT_ID` 恢复调用者 workspace。

## 3. 根因

**根因类型**：逻辑错误。

**根因描述**：Task Agent 的“使用调用者当前 workspace”契约在 CLI 回退处丢失了身份上下文。Paseo 已把 `PASEO_AGENT_ID` 注入 provider 进程，CLI 却只识别 workspace ID；因此它按合法的裸 run 语义创建了多个独立 workspace。问题不在侧边栏，也不能通过按 cwd 聚合 UI 解决。

**是否有多个根因**：是。主因是 CLI 没有从当前 Agent 恢复 workspace；次因是 Task Agent skill 允许 CLI 回退却没有明确禁止“当前 workspace”场景下的无身份裸 run。旧修复的宽泛迁移是第三个独立风险：它把合法的同 cwd 多 workspace 当成污染数据。

## 4. 影响面

- **影响范围**：任何从 Paseo-managed Agent 内调用裸 `paseo run` 的流程，尤其是并行 reviewer、QA、audit 和 implementation workers；外部终端中的裸 run 仍应保持“新 workspace”语义。
- **潜在受害模块**：Task Agent 适配器、CLI Agent run、workspace 侧边栏、Agent 历史归属；旧迁移还会波及所有主动使用同 cwd 多 workspace 的用户。
- **数据完整性风险**：有。误创建记录本身仍是结构上有效的数据；直接删除会留下悬空 Agent 外键。旧迁移则会把本应隔离的合法 workspace 状态和 Agent 归属合并。
- **严重程度复核**：维持 P2。导航显著受损，且旧迁移有错误归属风险，但当前没有观察到 Agent 内容丢失。

## 5. 修复方案

### 方案 A：继承当前 Agent workspace，并撤销宽泛迁移（推荐）

- **做什么**：CLI 裸 run 在存在 `PASEO_AGENT_ID` 时要求 `server_info.features.agentWorkspaceInheritance`，再 `fetchAgent` 并通过 active workspace 列表确认 exact `workspaceId`；显式 `--workspace`、`PASEO_WORKSPACE_ID`、`--worktree` 和真正的外部裸 run 语义保持不变。同步收紧 Task Agent skill 的 CLI 回退说明。移除按 cwd 合并全部 workspace 的启动迁移及调用。17 条误创建记录在 owner 授权后已通过正式 daemon RPC 软归档，不把该本机数据规则固化为通用迁移。
- **优点**：直接恢复 Task Agent 契约；不改变同 cwd 多 workspace 的产品能力；复用已有 `PASEO_AGENT_ID`；旧 daemon 通过单一 capability gate 明确提示更新，不拼接不可靠的兼容 RPC 路径。
- **缺点 / 风险**：CLI 需要父 Agent 与 active workspace 查询；若 host 太旧、`PASEO_AGENT_ID` 已失效、Agent 已归档或 workspace 不再 active，必须明确报错，不能静默创建新 workspace。现有数据清理需要单独的 daemon 停止许可。
- **影响面**：`packages/cli/src/commands/agent/run.ts` 及测试、`skills/paseo/SKILL.md`、旧迁移与 bootstrap 调用、`docs/agent-lifecycle.md`、`changes-by-cs.md` 及相关 issue 文档。

### 方案 B：只修 CLI 继承，保留旧启动迁移

- **做什么**：实现方案 A 的 CLI/skill 修复，但继续在每次启动时按 cwd 合并活跃 workspace。
- **优点**：当前本机数据可在重启时自动收敛，改动量更小。
- **缺点 / 风险**：明确违反 `Run multiple independent workspaces per directory` 的既有契约和回归测试，会错误合并用户主动创建的合法 workspace。
- **影响面**：CLI、skill；保留 server 数据误迁移风险。

### 方案 C：把所有裸 run 改成按 cwd 复用

- **做什么**：取消 CLI “每次 run 一个独立 workspace”的默认，所有未指定 workspace 的 run 都按 cwd 查找并复用。
- **优点**：无论调用来源都不会产生截图中的多条记录。
- **缺点 / 风险**：破坏同目录多 workspace 的产品能力、CLI 帮助文案与现有 E2E 契约；外部自动化无法再用裸 run 获得隔离 workspace。
- **影响面**：CLI、server workspace 语义、文档与多组 E2E，属于产品行为变更而非定点 bug 修复。

### 推荐方案

**推荐方案 A**。它利用已有调用者身份恢复正确 workspace 归属，既消除 Task Agent 批量产生的条目，又保留 Paseo 有意支持的 workspace multiplicity。生产数据清理与通用代码分开处理，避免再把本机症状固化成破坏领域模型的全局迁移。
