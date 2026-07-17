---
doc_type: issue-fix
issue: 2026-07-16-status-bar-permission-attention
path: fast-track
fix_date: 2026-07-16
tags:
  - status-bar
  - permissions
  - attention
---

# Status Bar 权限请求提醒修复记录

## 1. 问题描述

远端 Host 上的 agent `cbf5b584-6e4d-46b1-bb49-0779a0c7501b` 存在一个持续待处理的 `CodexBash` 权限请求。daemon 已广播 `agent_permission_request` 和 `status.summary.updated`，status bar 也把该会话计入通用“需关注”数量，但会话行无法显示盾牌图标和“等待权限”状态。

## 2. 根因

`StatusSummaryService.toStatusAgentSnapshot` 已读取 `agent.pendingPermissions.size` 并用它推导 `stateBucket: "needs_input"`，但 `attentionReason` 只读取 edge-triggered 的 `agent.attention`。权限请求是 level-triggered 的实时状态，不会写入 `agent.attention`，因此快照中的 `attentionReason` 为 `null`。UI 只能把仍处于 `running` 生命周期的会话显示为普通运行中。

## 3. 修复方案

当 `pendingPermissionCount > 0` 时，status summary 快照按既有 state bucket 优先级输出 `attentionReason: "permission"`；没有待处理权限时继续沿用现有 `agent.attention`。复用既有协议字段和 UI 分支，不新增协议字段，也不改变 daemon 广播链路。测试同时锁住权限优先于 finished、权限解除后恢复 finished 的状态回退。

## 4. 改动文件清单

- `packages/server/src/server/status-summary/status-summary-service.ts`：保留 pending permission 的权限语义。
- `packages/server/src/server/status-summary/status-summary-service.test.ts`：覆盖运行中 agent 存在 pending permission 时的快照输出。

## 5. 验证结果

- 修复前定向测试稳定失败：期望 `attentionReason: "permission"`，实际为 `null`。
- `npx vitest run packages/server/src/server/status-summary/status-summary-service.test.ts --bail=1`：5 个测试通过。
- `npx vitest run packages/app/src/status-summary/status-bar-running-sessions.test.tsx --bail=1`：24 个测试通过，确认现有 UI 会显示权限状态。
- `npm run typecheck`：全部 workspace 通过。
- `npm run lint`：0 warning，0 error。
- `npm run format:files -- ...`：本次代码与测试已格式化。

## 6. 遗留事项

- 远端 Host 的全局 `paseo` CLI 仍是 `0.1.75`，会因新版配置字段而无法连接；Desktop 内置 CLI `0.1.107` 可正常查询。该环境问题不影响本次修复，未在本 issue 中修改。
- 未重启本机或远端 daemon，未处理现场 pending permission，也未运行完整测试套件。
