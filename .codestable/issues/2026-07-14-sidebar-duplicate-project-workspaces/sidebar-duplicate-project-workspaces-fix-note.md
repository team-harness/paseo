---
doc_type: issue-fix-note
issue: 2026-07-14-sidebar-duplicate-project-workspaces
status: implemented
related:
  - sidebar-duplicate-project-workspaces-report.md
  - sidebar-duplicate-project-workspaces-analysis.md
tags: [sidebar, workspace, persistence, migration]
---

# 侧边栏重复项目条目修复记录

## 根因

`resolveOrCreateWorkspaceIdForCreateAgent` 在无显式 workspace、且没有新建 Paseo worktree 时，直接调用总会生成新 ID 的 `createWorkspaceForDirectory`。同一 cwd 每新建一个 Agent 就写入一条新的活跃 workspace 记录。

## 改动

- 创建 Agent 改用 `findOrCreateWorkspaceForDirectory`，首次创建保留 `initialTitle`，后续创建复用已有活跃 workspace，不覆盖其标题。
- 路径解析优先选择活跃 workspace；只存在归档记录时才按确定性顺序选择归档记录，避免历史重复项被错误重新激活。
- 新增启动时幂等迁移：同一规范 cwd 的活跃重复 workspace 选择最早创建的记录为规范记录，先将所有关联 Agent 的 `workspaceId` 重定向，再软归档其余记录。
- 在 registry bootstrap 的已有数据和首次物化两条路径都运行迁移。

## 现有数据处理

已确认 `~/.paseo/projects/workspaces.json` 中目标目录存在 14 条活跃重复记录。运行中的生产 daemon 持有 registry 和 Agent storage 的内存缓存；直接离线修改 JSON 既不会更新侧边栏，又可能被旧缓存写回，因此没有执行不安全的文件级删除。

修复版 daemon 在首次启动时自动完成重关联和软归档，目标目录将只保留最早创建的规范工作区记录，所有关联 Agent 均保留可用归属。

## 验证

- `mise exec nodejs@22.20.0 -- npx vitest run packages/server/src/server/migrations/consolidate-duplicate-workspaces.migration.test.ts packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.test.ts packages/server/src/server/workspace-registry-bootstrap.test.ts --bail=1`
  - 通过：3 个文件、20 个测试。
- `npm run format`
  - 通过。
- `npm run lint -- {6 个本次 server 文件}`
  - 通过，0 warnings / 0 errors。
- `npm run typecheck`
  - 通过，全部 workspace 成功。

## 遗留风险

- 现有桌面应用需要运行包含该修复的 daemon，启动迁移后才能安全清理已落盘的 14 条记录；本次不重启主 daemon，避免中断正在运行的 Agent。
- 未做人工 UI 验证，因为本次没有客户端 UI 改动；迁移完成后应确认 `CodeStable/main` 仅显示一条 workspace，随后在同一路径新建 Agent 确认仍不产生重复项。
