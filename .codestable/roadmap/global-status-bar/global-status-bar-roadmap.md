---
doc_type: roadmap
slug: global-status-bar
status: active
created: 2026-07-05
last_reviewed: 2026-07-06
tags: [app, status-bar, usage, agents]
related_requirements: []
related_architecture:
  [
    docs/architecture.md,
    docs/agent-lifecycle.md,
    docs/data-model.md,
    docs/design.md,
    docs/expo-router.md,
    docs/providers.md,
  ]
---

# 全局状态栏

## 1. 背景

用户希望在 Paseo UI 底部增加一个跨 tab、跨项目持续可见的 status bar，用来展示运行状态和进展：总 token 消耗、当日 token 消耗，以及当前运行中的 session 快照。第一版状态栏是 host-scoped：当 URL 位于 `/h/[serverId]/*` 的 host 内页面时持续可见；无单一 host 的全局路由（如根级 open-project/new/settings）隐藏。用户在同一 host 内切换 workspace、agent、sessions、host settings 时，都能从底部判断“这个 host 现在在干什么、今天用了多少、哪些 agent 正在跑”，并能从状态栏直接导航到对应 session。

现有代码已有两类相关信息：provider plan usage 是按需 fetch 的额度/余额信息；agent runtime snapshot 已经携带 `AgentUsage`，包括 token、cost 和 context window 字段。但 daemon 目前只维护覆盖式 `lastUsage` 快照，缺少带时间戳的 per-turn usage delta 历史。这个 epic 的核心是先建立“实际 agent 运行消耗”的可去重、可持久化数据源，再把“host 运行快照”做成 daemon 级、协议级、app 级的一条稳定数据流，最后落到 host shell 的底部 UI。

## 2. 范围与明确不做

### 本 roadmap 覆盖

- daemon 侧记录并聚合每个 host 的实际 agent 使用量：总 token、当日 token、可用时的总 cost、按 provider/model/session 的基础分解。
- 协议与 client SDK 增加一个向后兼容的 `status.summary` 数据契约，供新 app 一次性读取并订阅变化。
- app 在 host 级 shell 底部渲染全局状态栏，在 workspace、agent detail、host sessions、host settings 等 host 内页面保持可见；无单一 `serverId` 的全局路由隐藏。
- 状态栏展示当前运行中的 agent/session 快照，并支持从条目导航到 agent detail 或所属 workspace。
- 状态栏补充有价值的轻量信息：运行中数量、需要处理数量、最近完成数量、已有 provider plan usage 入口。
- 为 compact 和 desktop 分别定义占位、可访问性、安全区、键盘/浮层避让策略。

### 明确不做

- 不做 provider 账单系统或费用预测。`totalCostUsd` 只在 provider 已上报时累计展示，缺失时不估算。
- 不重新设计现有 provider usage tooltip / Host Usage settings；状态栏只链接已有 provider usage 入口，不把 provider quota 拉取并入 `status.summary` push。
- 不支持旧 daemon 上的降级实现。新 app 检测不到 capability 时隐藏或显示“Update the host to use this”，不 fan out 到旧 RPC 自行拼数据。
- 不改变 agent lifecycle、archive、tab close 语义；状态栏只读运行状态并导航，不承担关闭/归档操作。
- 不把 terminal activity 纳入 token 统计；terminal 只可作为未来状态来源扩展，不在本 epic 实现。

### Granularity Gate

| 判断项                    | 结论                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 为什么不是 single feature | 涉及 daemon 聚合、协议兼容、client SDK、app 全局 shell、导航和 UI 验证，且这些部分可以独立交付和验证。                                                                                                  |
| 为什么不是 brainstorm     | 用户目标清楚：底部 status bar、token 消耗、运行 session 快照、可导航；成功标准可拆成可观察 UI 和协议行为。                                                                                              |
| roadmap 边界              | 本次只覆盖 host 内全局状态栏和实际 agent 使用量聚合；不做账单预测、不改 provider usage 详情、不改生命周期操作。                                                                                         |
| 最小闭环                  | `usage-history-persistence` + `status-summary-protocol` 完成后，新 client 可从 daemon 获取包含 persisted lifetime/today usage totals 与 active sessions 的 host summary，这是 UI 可落地的最窄数据闭环。 |

## 3. 模块拆分（概设）

```text
全局状态栏
├── Usage Ledger：daemon 内记录可去重、带时间戳的 usage contribution
├── Status Summary Service：daemon 内聚合 usage ledger 和活跃 agent 快照
├── Status Summary Protocol：protocol/client 的 request + subscription 契约
├── App Status Store：app 内 host summary 缓存、capability gate 和派生 view model
└── Global Status Bar UI：host shell 底部状态栏、详情弹层和导航动作
```

### Usage Ledger · usage 持久化层

- **职责**：把 provider stream 里的 `usage_updated` / `turn_completed` 规范化为可去重的 usage contribution，记录 agentId、provider、turnId、timestamp、usage delta/snapshot basis，并持久化到 `$PASEO_HOME`。
- **承载的子 feature**：`usage-history-persistence`
- **触碰的现有代码 / 模块**：`packages/server/src/server/agent/agent-manager.ts`、`packages/server/src/server/agent/agent-storage.ts`、新增 `packages/server/src/server/status-summary/*` 或 `packages/server/src/server/usage-ledger/*`
- **Depth 判断**：deep。provider 是否给累计快照、单 turn 增量或中间更新，全部在 ledger 内部转成可聚合事实。

### Status Summary Service · daemon 聚合服务

- **职责**：从 agent snapshots、agent stream events 和新的 usage ledger / persisted usage state 中计算 host 级 summary；维护当日窗口和总量；输出稳定、provider-agnostic 的 DTO。
- **承载的子 feature**：`status-summary-protocol`、`usage-history-persistence`
- **触碰的现有代码 / 模块**：`packages/server/src/server/agent/agent-manager.ts`、`packages/server/src/server/agent/agent-storage.ts`、`packages/server/src/server/session/*`、`packages/server/src/server/messages.ts`、`packages/protocol/src/messages.ts`
- **Depth 判断**：deep。调用方只关心一个 summary DTO；provider 差异、turn usage 合并、当日窗口和 archived/live agent 合并都藏在服务内。

### Status Summary Protocol · 协议和 client SDK

- **职责**：定义 `status.summary.get.request/response` 与 `status.summary.updated`，并在 `server_info.features.statusSummary` 下暴露 capability。
- **承载的子 feature**：`status-summary-protocol`
- **触碰的现有代码 / 模块**：`packages/protocol/src/messages.ts`、`packages/client/src/daemon-client.ts`、`packages/server/src/server/session.ts`
- **Depth 判断**：deep。新 UI 不读取多个旧 RPC 拼数据；协议提供干净形状，feature gate 集中处理。

### App Status Store · app 状态接入层

- **职责**：在 host runtime/session store 旁维护每个 host 的 summary cache，处理初始 fetch、订阅更新、断线/旧 daemon 状态和 view model 派生。
- **承载的子 feature**：`app-status-summary-store`
- **触碰的现有代码 / 模块**：`packages/app/src/runtime/host-runtime.ts`、`packages/app/src/stores/session-store.ts` 或新建 `packages/app/src/status-summary/*`
- **Depth 判断**：deep。UI 消费 selector/view model，不直接处理协议细节、capability gate 或 reconnect 行为。

### Global Status Bar UI · 底部全局状态栏

- **职责**：在 host shell 底部渲染 summary、运行 session 快照、详情弹层和导航动作；处理 desktop/compact、安全区、浮层、键盘和 focus mode。
- **承载的子 feature**：`global-status-bar-shell`、`status-bar-running-sessions-nav`、`status-bar-polish-hardening`
- **触碰的现有代码 / 模块**：`packages/app/src/app/_layout.tsx`、`packages/app/src/app/h/[serverId]/_layout.tsx`、`packages/app/src/components/*`、`packages/app/src/styles/theme.ts`
- **Depth 判断**：中等。UI 模块只负责呈现和交互；状态计算留在 App Status Store。

## 4. 模块间接口契约 / 共享协议（架构层详设）

### 4.1 `status.summary.get.request` / `status.summary.get.response`

**方向**：App Status Store → Daemon Session

**形式**：WebSocket session RPC，使用 dotted namespace 和 `.request` / `.response` 后缀。

**契约**：

```ts
type StatusSummaryGetRequest = {
  type: "status.summary.get.request";
  requestId: string;
};

type StatusSummaryGetResponse = {
  type: "status.summary.get.response";
  requestId: string;
  payload: HostStatusSummaryPayload;
};
```

**约束**：

- 新 daemon 在 `server_info.features.statusSummary === true` 时才保证支持该 RPC。
- 新 app 检测不到 feature 时不调用该 RPC，也不通过 `agent_list` / timeline fan out 模拟缺失能力。
- response 必须可由旧 client 解析为 unknown session message 时忽略；新增 schema 字段全部 optional 或有默认。
- summary 时间戳由 daemon 生成，client 不按本地时间猜测窗口边界。

**Interface 设计检查**：

- Module / interface：`Session` 暴露 RPC；`StatusSummaryService` 提供 DTO。
- Seam placement：seam 放在 daemon session 边界，测试通过 client RPC 和 service 单元测试穿过这里。
- Depth / locality：usage 合并、当日窗口、stored/live agent 合并集中在 daemon service，不散到 app selectors。
- Dependency strategy：in-process；不引入 adapter。
- Adapter：无。只有 daemon 内部计算，不需要 production/test 双 adapter。

### 4.2 `status.summary.updated`

**方向**：Daemon Session → App Status Store

**形式**：WebSocket session push message。

**契约**：

```ts
type StatusSummaryUpdatedMessage = {
  type: "status.summary.updated";
  payload: HostStatusSummaryPayload;
};
```

**约束**：

- 只有 client 已经完成 hello 且 daemon feature gate 支持时发送。
- service 在 agent status、usage、archive、attention 变化时 coalesce 更新，避免每个 stream chunk 都触发完整 summary。
- 客户端以 push 为即时值，但 reconnect 后必须重新 `status.summary.get.request` 获取权威快照。
- `.updated` 是无一一对应 response 的 server push message；实现时必须在 protocol schema 附近注明命名理由，或同步补充 `docs/rpc-namespacing.md` 的 push/notification 命名约定。

**Interface 设计检查**：

- Module / interface：daemon session 订阅 `AgentManager`/summary service 变化并发出 push。
- Seam placement：seam 放在 summary service 的 `subscribe(listener)` 或 session 事件桥接层；测试可用 fake agent events 验证 coalescing。
- Depth / locality：UI 不关心事件来源，只处理完整 summary snapshot。
- Dependency strategy：in-process。
- Adapter：无。

### 4.3 `HostStatusSummaryPayload`

**方向**：Status Summary Service → Protocol / App Status Store / UI

**形式**：共享 TypeScript + Zod schema。

**契约**：

```ts
type HostStatusSummaryPayload = {
  generatedAt: string; // ISO8601 daemon time
  usage: {
    lifetime: UsageTotals;
    today: UsageTotals & { windowStart: string; windowEnd?: string | null };
    byProvider?: UsageBucket[];
    byModel?: UsageBucket[];
  };
  activity: {
    runningAgents: StatusAgentSnapshot[];
    needsAttentionAgents: StatusAgentSnapshot[];
    recentlyCompletedAgents: StatusAgentSnapshot[];
    counts: {
      running: number;
      needsAttention: number;
      idle: number;
      error: number;
    };
  };
};

type UsageTotals = {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  totalCostUsd?: number;
};

type UsageBucket = UsageTotals & {
  id: string;
  label: string;
};

type StatusAgentSnapshot = {
  id: string;
  provider: AgentProvider;
  title: string | null;
  status: AgentStatus;
  cwd: string;
  workspaceId?: string;
  model?: string | null;
  updatedAt: string;
  lastUsage?: AgentUsage;
  parentAgentId?: string | null; // derived from labels["paseo.parent-agent-id"]
  attentionReason?: "finished" | "error" | "permission" | null;
};
```

**约束**：

- `totalTokens = inputTokens + cachedInputTokens + outputTokens`，只对存在的数字求和；字段缺失表示 provider 没提供，不显示为 0。
- `today` 使用 daemon 本地日历日窗口；后续如需用户时区可另加 optional timezone 字段。
- `recentlyCompletedAgents` 只包含短窗口内完成且需要用户查看的 agent，避免状态栏变成历史列表。
- `StatusAgentSnapshot.workspaceId` 是导航主键，不能从 `cwd` 推导 ownership。
- `StatusAgentSnapshot.parentAgentId` 由 daemon service 从 labels 的 `paseo.parent-agent-id` 派生；protocol 不要求 client 再自行解析 labels。
- provider plan usage 不进入 `HostStatusSummaryPayload` v1。状态栏只显示“Usage”入口或复用 app 侧已经存在的 `provider.usage.list` React Query 缓存，不由 daemon summary push 触发 provider 拉取。

**Interface 设计检查**：

- Module / interface：protocol DTO 是唯一跨 daemon/app 共享形状。
- Seam placement：daemon service 输出该 DTO；app store 消费该 DTO。
- Depth / locality：新增字段可向后兼容追加；UI 不依赖 provider-specific 字段。
- Dependency strategy：in-process + WebSocket。
- Adapter：无。

### 4.4 App view model

**方向**：App Status Store → Global Status Bar UI

**形式**：hook/selector，例如 `useHostStatusSummary(serverId)` 和 `useGlobalStatusBarView(serverId)`。

**契约**：

```ts
type GlobalStatusBarView =
  | { kind: "hidden"; reason: "no-host" | "focus-mode" | "unsupported" }
  | { kind: "loading" }
  | { kind: "ready"; summary: HostStatusSummaryPayload; primaryRows: StatusBarRow[] }
  | { kind: "error"; message: string };

type StatusBarRow = {
  kind: "usage" | "activity" | "agent";
  label: string;
  value: string;
  tone?: "default" | "ok" | "warning" | "danger";
  target?:
    | { kind: "agent"; serverId: string; agentId: string }
    | { kind: "workspace"; serverId: string; workspaceId: string };
};
```

**约束**：

- UI 只读 view model；所有 number formatting、empty/loading/error copy 在 view model 或 copy helper 中集中处理。
- 导航到 workspace 使用 `navigateToWorkspace(serverId, workspaceId)`；导航到 agent 使用现有 host agent detail route。
- Compact 默认展示一行摘要，点击/上拉展开详情；desktop 可展示更多 inline chips。
- `no-host` 表示当前 route 不在 `/h/[serverId]/*` host 边界内；第一版不在 app-global 路由上任选 earliest online host。

## 5. 子 feature 清单

1. **usage-history-persistence** — 增加 usage ledger 或 persisted usage state，定义 provider usage event 去重和 today/lifetime 重建算法。
   - 所属模块：Usage Ledger / Status Summary Service
   - 依赖：无
   - 状态：done
   - 对应 feature：2026-07-06-usage-history-persistence
   - 备注：必须证明跨天、daemon 重启、archived agent 三种情形可计算；现有 stored agent schema 没有 `lastUsage`，持久 timeline 也不天然保存 `usage_updated` 事件。

2. **status-summary-protocol** — 定义 daemon status summary 聚合服务、协议 schema、client SDK 方法和 server feature gate。
   - 所属模块：Status Summary Service / Status Summary Protocol
   - 依赖：`usage-history-persistence`
   - 状态：done
   - 对应 feature：2026-07-06-status-summary-protocol
   - 备注：最小闭环；完成后无需 UI 也可用 RPC 证明 persisted lifetime/today summary 可读取。

3. **app-status-summary-store** — app 接入 summary RPC 和 push，提供 host 级 cache、capability gate、reconnect refresh 和 view model。
   - 所属模块：App Status Store
   - 依赖：`status-summary-protocol`
   - 状态：done
   - 对应 feature：2026-07-06-app-status-summary-store
   - 备注：不在 UI 中散落旧 daemon 防御分支。

4. **global-status-bar-shell** — 在 host shell 底部渲染跨页面状态栏，展示 total/today tokens、cost、运行中/需处理计数，并处理 layout/safe-area。
   - 所属模块：Global Status Bar UI
   - 依赖：`app-status-summary-store`
   - 状态：done
   - 对应 feature：2026-07-06-global-status-bar-shell
   - 备注：应落在 `packages/app/src/app/h/[serverId]/_layout.tsx` 的 host 边界内或其直接子组件；无单一 `serverId` 的全局路由隐藏。

5. **status-bar-running-sessions-nav** — 为状态栏增加运行中 session 快照、详情弹层和导航到 agent/workspace 的动作。
   - 所属模块：Global Status Bar UI
   - 依赖：`global-status-bar-shell`
   - 状态：done
   - 对应 feature：2026-07-06-status-bar-running-sessions-nav
   - 备注：导航必须遵守 Expo Router 文档和 workspace helper。

6. **status-bar-polish-hardening** — 收口状态栏的 compact/desktop 表现、旧 daemon gate、无数据/错误态、可访问性、视觉回归和文档沉淀。
   - 所属模块：Global Status Bar UI / App Status Store
   - 依赖：`global-status-bar-shell`、`status-bar-running-sessions-nav`、`usage-history-persistence`
   - 状态：done
   - 对应 feature：2026-07-06-status-bar-polish-hardening
   - 备注：覆盖边界输入、截图验证、i18n copy、docs/attention 候选沉淀。

**最小闭环**：第 1 条 `usage-history-persistence` 提供可持久化 usage source，第 2 条 `status-summary-protocol` 暴露 RPC 后，新 client/CLI 测试能调用 `status.summary.get.request` 获取 persisted lifetime/today usage totals 和 active session snapshot，证明底部状态栏的数据源成立。

### Goal Coverage Matrix

| Goal / completion signal                                   | Covered by item(s)                                        | Verification entry                                                                                                 | Evidence type          | Core? |
| ---------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------- | ----- |
| daemon 能返回 host 级 total/today token summary            | `status-summary-protocol`, `usage-history-persistence`    | `npx vitest run packages/protocol/src/messages.test.ts packages/server/src/server/session/... --bail=1` 的目标文件 | test / protocol parse  | yes   |
| daemon 重启或 archived agent 后仍能计算总量和当日量        | `usage-history-persistence`                               | server store/service 目标测试 + fixture agent records                                                              | test                   | yes   |
| app 能在支持 capability 的 host 上读取并维护 summary cache | `app-status-summary-store`                                | app store/hook 目标测试                                                                                            | test                   | yes   |
| host 内任意 tab/page 底部可见状态栏                        | `global-status-bar-shell`                                 | Expo web/native 手工路径或 Playwright screenshot                                                                   | screenshot / manual QA | yes   |
| 状态栏展示运行中 session 快照并可导航                      | `status-bar-running-sessions-nav`                         | 点击 running agent chip → agent detail/workspace                                                                   | manual QA / route test | yes   |
| 旧 daemon 不出现错误请求或散落 fallback                    | `app-status-summary-store`, `status-bar-polish-hardening` | feature gate unit test + manual old-feature-disabled state                                                         | test / QA              | yes   |
| provider plan usage 有清晰入口但不并入 summary push        | `global-status-bar-shell`, `status-bar-polish-hardening`  | provider usage unavailable / configured 两种状态                                                                   | QA                     | no    |

## 6. 排期思路

先做 `usage-history-persistence`，因为“当日 token”需要带时间戳的 usage contribution，不能从当前覆盖式 `lastUsage` 快照推导。第二步做 `status-summary-protocol`，把 persisted lifetime/today 与 active session snapshot 暴露成单一协议，不让 UI 从 `agent_update`、timeline、provider usage 多处拼装。第三步接 app store，把 capability gate 和 reconnect 放在一个地方。第四、第五步做状态栏壳和运行 session 导航。最后单独收口 hardening，覆盖 compact、desktop、安全区、旧 daemon、无数据、错误态、截图和文档沉淀。

技术依赖顺序大致固定；产品优先级里，状态栏 inline 展示哪些补充指标（cost、provider plan usage、recent completions）可以在 UI feature design 时由用户拍板。

## 7. 风险、假设与观察项

### 目标完成信号

- 支持新 daemon 的 host 页面底部始终可见一条状态栏，切换 workspace/agent/sessions/settings 后仍存在。
- 状态栏显示 lifetime tokens、today tokens、运行中 agent 数、需要处理 agent 数；有 cost 数据时显示 cost，无数据时不伪造。
- 状态栏展开后列出当前运行中的 agent/session，点击可导航到 agent detail 或 workspace。
- daemon restart 后 summary 仍能给出可解释的 lifetime/today 统计；实现证据必须来自 persisted usage ledger/state，而不是当前进程内存。

### Top 3 风险与缓解

1. **usage 事件语义不一致导致重复累计**：不同 provider 可能在 `usage_updated` 和 `turn_completed` 上报累计值或单 turn 值。缓解：第一条 feature 必须先定义 merge semantics，并用 Claude/Codex/OpenCode/Pi/mock provider fixture 覆盖；去重后的 usage 必须写入 ledger 或 persisted state。
2. **全局底部栏挤压 composer、浮层或移动安全区**：workspace composer 和 compact gesture 已经复杂。缓解：UI feature 单独处理 shell layout，不把状态栏塞进 workspace pane；最后 hardening 做截图/手工验证。
3. **旧 daemon 兼容误用**：新 app 若从旧 RPC 拼 fallback，会制造不可删分支。缓解：`server_info.features.statusSummary` 单点 gate，并写 `COMPAT(statusSummary)` 注释。

### 非显然依赖

- `docs/expo-router.md`：host leaf route 和 app-wide route hops 对导航有硬约束；状态栏导航必须使用现有 helper。
- `docs/agent-lifecycle.md`：workspace ownership 只能用 `workspaceId`，不能从 `cwd` 推导。
- `docs/providers.md`：provider plan usage 是 fetch-on-demand，不能假设有 push subscription。
- 现有 `AgentUsage` 没有 total token 字段，需要服务端统一求和或协议扩展 optional 字段。
- 现有 stored agent record schema 没有 `lastUsage`；runtime `agent.lastUsage` 会进入 snapshot payload，但不足以支撑 daemon restart 后的 lifetime/today 统计。
- host-scoped 挂载要求从 `/h/[serverId]/*` route context 读取 serverId；不在 root app layout 中任选 host。

### 关键假设

- `AgentUsage` 已经覆盖本需求第一版需要的单次/当前消耗字段：input/cached/output/cost/context window。
- 第一个实现 feature 能把 provider usage event 规范化为可去重、带 daemon timestamp 的 usage contribution；如果发现 provider 只能提供累计快照，必须在 ledger 内按 agent/turn/provider 保存上次快照再计算 delta。
- 当日 token 的窗口按 daemon 本地日历日即可满足第一版；不需要 per-client timezone。
- 用户要的是“运行状态和进展”的持久在线索引，不是精确账单核算。
- host 内页面都可以接受底部保留一条低高度 chrome；focus mode 下是否隐藏由 UI design 再拍板，当前规划默认可隐藏。

### 基线与验证入口

- 协议：`packages/protocol/src/messages.test.ts` 目标测试。
- server：新增/目标运行 status summary service/session 测试，不跑全量 suite。
- app store/UI：目标运行相关 hook/store/component 测试。
- 视觉：web/desktop Playwright screenshot 或 Expo 手工检查 compact/desktop；必要时补移动安全区验证。
- 全仓库规则：变更后运行 `npm run typecheck`、`npm run lint`；当前 checkout 若缺 `tsgo`/`oxlint`，需先安装依赖或记录环境阻塞。

### 交付物落点

- 协议与类型落在 `packages/protocol/src/messages.ts` / `packages/protocol/src/agent-types.ts`。
- client SDK 方法落在 `packages/client/src/daemon-client.ts`。
- daemon 聚合和 session wiring 落在 `packages/server/src/server/session/*` 或 `packages/server/src/server/status-summary/*`。
- usage ledger/state 若新增持久化文件，落在 `$PASEO_HOME` 下并同步更新 `docs/data-model.md`；若扩展 stored agent record，必须遵守 optional 字段兼容规则。
- app store/view model 落在 `packages/app/src/status-summary/*` 或现有 store 的清晰子模块。
- UI 组件落在 `packages/app/src/components/` 或 `packages/app/src/status-summary/`，shell 挂载点在 `packages/app/src/app/h/[serverId]/_layout.tsx` 的 host 边界内或其直接子组件；不挂在 root `packages/app/src/app/_layout.tsx` 作为 app-global 单例。
- 文档沉淀候选：完成后更新 `docs/architecture.md`、`docs/providers.md` 或新增 `docs/status-summary.md`，视实现实际影响决定。

### 知识回写点

- 如果确认 `AgentUsage` 的 provider merge semantics 和 persisted usage ledger 形状，acceptance 阶段应沉淀到 docs 或 `.codestable/compound/`。
- 如果状态栏 shell layout 对 composer/keyboard 有新约束，应沉淀到 `docs/design.md` 或 `docs/expo-router.md`。
- 如果发现当前依赖缺失（如 `tsgo`/`oxlint`），可用 `cs-note` 追加到 `.codestable/attention.md` 的命令陷阱。

## 8. 观察项

- `docs/providers.md` 已明确 provider plan usage 是 fetch-on-demand；如果状态栏需要实时 quota warning，可能要另起一份 provider usage subscription roadmap。
- 现有 context window meter 已在 composer 中展示当前 agent usage；状态栏要避免重复做成第二个大 context meter，应保持摘要化。
- 状态栏可能对 focus mode 有产品分歧：隐藏能最大化工作区空间，显示能持续可见运行状态。UI design 阶段需要用户拍板。
- `packages/server/src/server/agent/agent-storage.ts` 当前 stored schema 未包含 `lastUsage`；`usage-history-persistence` 不能假设 agent record 已经持久保存 usage。
- app-global 状态栏（根路由也显示并自动选择 earliest online host）是未来可选扩展，不在第一版范围内。

## 9. 变更日志

- 2026-07-05：创建 draft roadmap，拆出 usage summary 数据闭环、app 接入、底部 UI、运行 session 导航和 hardening。
- 2026-07-05：按独立 review 修订：usage ledger 前置为强依赖，状态栏明确为 host-scoped，provider plan usage 不并入 `status.summary` push。
