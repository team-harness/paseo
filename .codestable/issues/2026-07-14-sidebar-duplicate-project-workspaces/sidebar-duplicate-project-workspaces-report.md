---
doc_type: issue-report
issue: 2026-07-14-sidebar-duplicate-project-workspaces
status: confirmed
severity: P2
summary: Task Agent CLI 回退为同一调用者 workspace 重复创建侧边栏条目
tags: [sidebar, workspace, task-agent, cli]
---

# 侧边栏重复项目条目 Issue Report

## 1. 问题现象

在侧边栏中，工作流从一个既有 workspace 批量创建 Task Agent 后，每个 Agent 都产生一条同 cwd、同分支的新 workspace 条目。最初在 `~/work/freetalk/CodeStable` 观察到该现象；2026-07-15 在 `/Users/wyatt/work/cs-agent` 再次稳定复现，截图中出现大量相同的 `main` 条目。

现场 registry 最初显示 `/Users/wyatt/work/cs-agent` 有 17 条活跃 workspace：1 条原有 workspace，以及按 `6、3、3、3、1` 批次在同一秒创建的 16 条新记录。修复期间旧生产 daemon 又由 `Headless roadmap independent review` Task Agent 创建 `wks_6f418adc6101e589`，清理前累计为 18 条活跃 workspace、17 条误创建记录。owner 授权后，17 条重复 workspace 已通过 daemon RPC 软归档，当前只剩 canonical 1 条 active。

## 2. 复现步骤

1. 在已有 Paseo workspace 中运行一个能够调度多个 reviewer 的 Agent。
2. 当原生 Paseo Agent 工具不可用时，让 Task Agent 适配器回退到 CLI，并从同一 cwd 批量执行 `paseo run`。
3. 观察 daemon 收到每个 reviewer 各一组 `workspace.create.request` 和 `create_agent_request`。
4. 观察侧边栏：同一路径、同分支的 `main` workspace 按 reviewer 数量持续增加。

复现频率：当前项目稳定出现；目前仅观察到该项目受影响。

## 3. 期望 vs 实际

**期望行为**：声明使用调用者当前 workspace 的 Task Agent 应全部附着到该 workspace，不新增侧边栏条目。用户显式要求新 workspace/worktree 时，仍应保留 Paseo 支持的同 cwd 多 workspace 能力。

**实际行为**：CLI 回退无法得到调用者 workspace ID，裸 `paseo run` 按设计为每次运行创建一个独立 workspace，导致 Task Agent 被错误放置并形成大量条目。

## 4. 环境信息

- 涉及模块 / 功能：Task Agent 适配器、CLI Agent 创建、workspace 归属、桌面端侧边栏
- 相关文件 / 函数：`skills/paseo/SKILL.md`、`packages/cli/src/commands/agent/run.ts:resolveRunWorkspace`
- 运行环境：macOS 桌面测试版，生产 daemon 端口 `6767`
- 现场证据：daemon metrics 中 reviewer 批次的 `workspace.create.request` 数量与 `create_agent_request` 数量完全一致；持久化 workspace 的创建时间与这些批次一致。

## 5. 严重程度

**P2** — 项目与工作区仍可使用，但重复条目破坏侧边栏组织并妨碍定位正确工作区。

## 备注

用户要求直接定位并修复。验收要求包括：同一父 Agent 再批量创建 Task Agent 时不再新增 workspace 条目；17 条误创建记录需保留历史并完成定点清理。数据已通过在线 daemon RPC 软归档，没有直接修改 JSON；防复发的修复版 daemon/CLI 尚待更新与重启后验收。
