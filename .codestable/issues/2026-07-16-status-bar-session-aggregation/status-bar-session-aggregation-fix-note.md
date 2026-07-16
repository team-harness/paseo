---
doc_type: issue-fix
issue: 2026-07-16-status-bar-session-aggregation
path: standard
fix_date: 2026-07-16
related:
  - status-bar-session-aggregation-analysis.md
tags:
  - status-bar
  - multi-host
  - sessions
---

# Status Bar 会话聚合异常修复记录

## 1. 实际采用方案

采用分析中的方案 A，在客户端统一可见会话口径并保留 Host 归属：会话 badge 从折叠后的列表条目统计；打开会话面板时并行刷新所有相关 Host summary；历史展示当前已加载的全部可见顶层会话；Pin 列表聚合所有支持该能力的 Host，并按条目所属 Host 导航。

Pin 数据所有权和持久化没有变化，仍由各 Host/daemon 负责；本次没有修改协议或服务端。

## 2. 改动文件清单

- `packages/app/src/status-summary/status-bar-running-sessions.tsx`：统一 badge 与列表计数口径，通过全局 Host runtime 增加面板打开刷新，移除历史 10 条截断，并扩展 Pin source 的 Host 标签。
- `packages/app/src/status-summary/status-bar-session-pins.tsx`：聚合多 Host Pin，显示 Host 标签并按所属 Host 导航。
- `packages/app/src/status-summary/global-status-bar.tsx`：把完整的多 Host Pin sources 传给 Pin trigger。
- `packages/app/src/status-summary/status-bar-running-sessions.test.tsx`：增加父子 agent 计数、跨 Host 刷新、完整历史和跨 Host Pin 导航回归测试。
- `packages/app/src/status-summary/global-status-bar.test.tsx`：隔离新增的 Host runtime 依赖，保持全局状态栏测试环境稳定。
- `.codestable/issues/2026-07-16-status-bar-session-aggregation/`：问题报告、根因分析和本修复记录。

## 3. 验证结果

- `npx vitest run packages/app/src/status-summary/status-bar-running-sessions.test.tsx --bail=1`：24 个测试通过。
- `npx vitest run packages/app/src/status-summary/global-status-bar.test.tsx --bail=1`：11 个测试通过。
- `npm run typecheck`：全部 workspace 通过。
- `npm run lint`：0 warning，0 error。
- `npm run format:files -- ...`：本次改动文件已格式化。

## 4. 遗留事项

- 历史列表展示 `useAgentHistory` 当前已经加载的全部可见条目，仍受该 hook 单次加载/分页策略约束；本次不改变历史 RPC 或分页模型。
- 未重启主 daemon，也未执行完整测试套件；按仓库约束仅运行受影响的定向测试。
