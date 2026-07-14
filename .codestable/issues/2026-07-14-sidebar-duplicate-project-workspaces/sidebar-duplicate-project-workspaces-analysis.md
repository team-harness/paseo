---
doc_type: issue-analysis
issue: 2026-07-14-sidebar-duplicate-project-workspaces
status: confirmed
root_cause_type: logic
related: [sidebar-duplicate-project-workspaces-report.md]
tags: [sidebar, workspace, persistence, migration]
---

# 侧边栏重复项目条目根因分析

## 1. 问题定位

| 关键位置                                                                                                                               | 说明                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.ts:resolveOrCreateWorkspaceIdForCreateAgent` | 无指定 workspace 的新建 Agent 直接调用 `createWorkspaceForDirectory`。         |
| `packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.ts:createWorkspaceForDirectory`              | 每次调用都会生成新的 workspace ID 并持久化，即使同一 cwd 已有活跃记录。        |
| `packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.ts:findOrCreateWorkspaceForDirectory`        | 已存在正确的复用路径，但创建 Agent 时没有使用。                                |
| `~/.paseo/projects/workspaces.json`                                                                                                    | 受影响目录存在 14 条活跃记录，且多个 Agent 的 `workspaceId` 分别引用这些记录。 |

## 2. 失败路径还原

**正常路径**：用户在同一目录新建 Agent，服务端查询该目录的活跃 workspace，复用其 ID，侧边栏只出现一个工作区条目。

**失败路径**：用户在同一目录新建 Agent，`resolveOrCreateWorkspaceIdForCreateAgent` 绕过查询逻辑，直接创建并持久化新 workspace ID，侧边栏按 workspace ID 渲染出新的重复条目。

**分叉点**：`workspace-provisioning-service.ts:resolveOrCreateWorkspaceIdForCreateAgent` 对无 `requestedWorkspaceId` 的请求调用 `createWorkspaceForDirectory`，而不是 `findOrCreateWorkspaceForDirectory`。

## 3. 根因

**根因类型**：逻辑错误。

**根因描述**：创建 Agent 的专用分支没有遵循该模块已定义的“按目录查找或创建”不变量，导致同一路径可被重复登记为多个活跃 workspace。数据已落盘，因此重启不会自行消除重复项。

**是否有多个根因**：否。侧边栏分组正确地按这些不同 workspace 记录展示；问题源于服务端持久化数据被污染。

## 4. 影响面

- **影响范围**：所有未传 `requestedWorkspaceId` 且未创建 Paseo worktree 的新建 Agent 路径。
- **潜在受害模块**：项目侧边栏、workspace 恢复、按 workspace 归属的 Agent 历史。
- **数据完整性风险**：有。直接删除重复 workspace 会让仍引用其 ID 的 Agent 失去归属。
- **严重程度复核**：维持 P2。不会丢失 Agent，但会持续污染持久化数据并影响导航。

## 5. 修复方案

### 方案 A：根治并迁移历史数据

- **做什么**：新建 Agent 改用既有查找/创建路径；启动时将同一规范 cwd 的重复活跃 workspace 归并到最早记录，把 Agent 的 `workspaceId` 改指向规范记录，再软归档重复记录。
- **优点**：同时阻止新污染并清理已有 14 条记录，不破坏 Agent 历史归属；可幂等重跑。
- **缺点 / 风险**：涉及启动时持久化迁移，必须保证先迁移 Agent 再归档 workspace。
- **影响面**：workspace provisioning、workspace registry bootstrap、目标测试与新增迁移测试。

### 方案 B：仅修复创建路径

- **做什么**：只让新建 Agent 调用 `findOrCreateWorkspaceForDirectory`。
- **优点**：改动最小。
- **缺点 / 风险**：当前持久化的重复条目继续存在，不能满足用户要求的清理结果。
- **影响面**：仅 workspace provisioning。

### 方案 C：手工删除重复 workspace

- **做什么**：直接从 `workspaces.json` 删除重复记录。
- **优点**：表面上立即减少侧边栏条目。
- **缺点 / 风险**：已有 Agent 仍引用被删 ID，造成历史和恢复归属不一致；不能阻止后续重复。
- **影响面**：生产数据，风险不可接受。

### 推荐方案

**推荐方案 A**。它修复唯一根因，并以先迁移 Agent、后软归档 workspace 的顺序安全修复现有数据。用户已明确要求直接修复并至少清理为一条，按方案 A 执行。
