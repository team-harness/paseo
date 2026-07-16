---
doc_type: issue-analysis
issue: 2026-07-16-status-bar-session-aggregation
status: confirmed
root_cause_type: logic
related:
  - status-bar-session-aggregation-report.md
tags:
  - status-bar
  - multi-host
  - stale-state
---

# Status Bar 会话聚合异常根因分析

## 1. 问题定位

| 关键位置                                                              | 说明                                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `packages/app/src/status-summary/status-bar-running-sessions.tsx:271` | 会话 badge 直接累加原始 `needsAttentionAgents` / `runningAgents`，没有复用列表折叠后的 `items`。 |
| `packages/app/src/status-summary/status-bar-session-navigation.ts:53` | 展开列表会把子 agent 折叠到顶层 agent，并通过 `seen` 去重，因此与 badge 天然可能不同。           |
| `packages/app/src/status-summary/status-bar-running-sessions.tsx:299` | 会话面板打开只更新本地 `open`，没有像历史面板一样主动刷新 Host summary。                         |
| `packages/app/src/status-summary/status-bar-running-sessions.tsx:418` | 历史记录在过滤后固定执行 `.slice(0, 10)`。                                                       |
| `packages/app/src/status-summary/global-status-bar.tsx:177`           | Pin trigger 仅接收当前 Host 的 `pinnedSessions` 和 capability。                                  |
| `packages/app/src/status-summary/status-bar-session-pins.tsx:60`      | Pin 行的导航目标统一使用 trigger 级 `serverId`，数据模型无法表达多 Host 条目归属。               |

## 2. 失败路径还原

**正常路径**：各 Host summary 进入全局 status bar → 客户端按 Host 构建会话、历史和 Pin 条目 → badge、展开列表和导航都基于同一聚合结果 → 打开面板时主动校准数据。

**失败路径**：各 Host summary 已正确聚合 → 会话列表继续执行顶层 agent 折叠，但 badge 绕过该结果统计原始数组 → 数字与条目分叉；展开会话面板时没有触发 RPC 刷新 → 错过推送或恢复场景下继续展示旧状态；历史过滤后再被固定上限截断；Pin trigger 在全局聚合完成前重新收窄到当前 Host。

**分叉点**：`status-bar-running-sessions.tsx:271`、`status-bar-running-sessions.tsx:299`、`status-bar-running-sessions.tsx:418` 和 `global-status-bar.tsx:177` 分别引入了统计口径、刷新时机、展示上限和 Host 范围的不一致。

## 3. 根因

**根因类型**：逻辑错误。

**根因描述**：状态栏虽然已经持有多 Host summary，但四个展示路径没有共享同一个聚合视图：badge 使用原始 agent 数，列表使用折叠会话数；会话面板只依赖推送而没有打开时校准；历史组件额外施加 10 条 UI 上限；Pin 组件的数据项不携带 Host 归属，只能按当前 Host 渲染和导航。

**是否有多个根因**：是。主因是 UI 各入口重复派生数据且口径不同；次因是会话面板缺少显式刷新，导致状态恢复依赖 WebSocket 推送是否完整到达。

## 4. 影响面

- **影响范围**：单 Host 下会出现子 agent 导致的计数偏差和历史截断；多 Host 下还会遗漏其他 Host 的 Pin，并可能展示跨 Host 的陈旧会话状态。
- **潜在受害模块**：status bar 会话 badge、会话列表、历史列表、Pin 列表及从 Pin 发起的导航。
- **数据完整性风险**：无持久化数据损坏；Pin 仍由 Host/daemon 保存。风险集中在客户端展示与导航上下文不完整。
- **严重程度复核**：维持 P1，因为核心监控信息不可信且多 Host 快速导航会漏项。

## 5. 修复方案

### 方案 A：统一客户端可见项口径并补 Host 归属

- **做什么**：badge 从已经折叠的 `items` 统计；打开会话面板时刷新所有相关 Host summary；历史展示当前已加载的全部可见顶层会话；Pin trigger 接收带 `serverId` / `serverLabel` 的多 Host source，展开后按条目所属 Host 导航。
- **优点**：直接修复四个分叉点，不改协议和 daemon；复用已有多 Host summary 与刷新 RPC；向后兼容范围清晰。
- **缺点 / 风险**：历史列表可能明显变长，需要依赖现有滚动容器；打开会话面板会产生每 Host 一次 summary 请求。
- **影响面**：仅 status summary 客户端组件及其定向测试。

### 方案 B：服务端新增全局状态栏聚合协议

- **做什么**：由某个中心 daemon 或客户端协调层生成全局会话数、全局 Pin 条目和历史分页，再让 UI 直接渲染协议结果。
- **优点**：理论上可以把所有展示口径集中在一个服务层。
- **缺点 / 风险**：Host 之间没有天然的服务端全局所有者，需要新增协议、跨 Host 协调和兼容门；改动远超本次 bug 范围。
- **影响面**：protocol、server、client、app 和兼容测试。

### 推荐方案

**推荐方案 A**，理由：现有客户端已经拿到每个 Host 的权威 summary，问题仅发生在 UI 派生和刷新边界；在客户端统一口径可以最小范围恢复正确行为，同时保持 Pin 跟随 Host 持久化的设计。
