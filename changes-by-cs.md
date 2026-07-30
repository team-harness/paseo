# Fork Change Ledger

本文件记录 `team-harness/paseo` 相对原作者仓库的产品和运行时改动，用于后续同步上游时快速判断：保留、迁移到上游实现，还是下线本 fork 的重复代码。

这不是发布说明，也不是完整 Git diff。每次增加会影响运行时行为、协议、持久化数据或桌面打包的 fork 改动时，必须在这里补一条记录。

## 比较基线

- Fork remote：`origin` -> `git@github.com:team-harness/paseo.git`
- 上游 remote：`upstream` -> `git@github.com:getpaseo/paseo.git`
- 初始记录基线：`upstream/main` = `f2ebac931c60ed423968f1aa07ba78c0a0b2776c`，记录于 2026-07-14。
- 最近同步基线：`upstream/main` = `d1ce2b77f7adb13a7f9f3d1b778c9a2efdadf460`，同步于 2026-07-30。
- 最近同步 merge commit：`285733080`。

同步时以 `upstream/main` 为原作者来源，不要把 `origin` 误认为上游。

## 总体决策原则

1. 上游已经提供同等能力时，以**上游实现为准**。删除或迁移本 fork 的重复实现、测试和文案，不保留双路径。
2. 对 Status Bar、持久化数据和协议改动，先保证数据/协议兼容，再处理 UI 冲突。不得用旧 RPC 拼装新能力的降级路径。
3. 对现有 Agent 的 `workspaceId`、usage ledger、session pin 等持久化数据，不能直接删除记录；先检查迁移和归属关系。
4. `.codestable/` 是 fork 的工程流程和审计资产，不改变 Paseo 运行时行为。上游若也引入同名流程文件，保留双方必要约束，避免用上游版本整目录覆盖。
5. 解决冲突后，更新本文件中的“同步状态”和“上游等价实现”判断，并在对应区域跑目标测试。

## 最近同步判断

### 2026-07-30: `upstream/main` `d1ce2b77f` / `v0.2.4`

- 合入上游跨 Host 项目分组恢复、`project.list` 协议与项目级设置路由、旧 GitHub CLI 仓库搜索兼容、Agent cwd 注入、idle Agent 后台任务保活、completion 缺失 usage 时保留 context window，以及文件树恢复/checkout diff 稳定性修复。
- 上游时间线 optimistic/pagination rework 已回滚；采用其当前的虚拟化 DOM 结构和 `processTimelineResponse` 本地用户消息 reconciliation，不保留 fork 的 `data-history-row-id` 包装层或已移除的 `sendingClientMessageIds` / `hasAuthoritativeBaseline` 参数。聊天分享继续以 captured tail/head 加载全部 older 页面，并复用该 reducer 产出完整导出历史。
- 上游的 schedule 改动只修复项目 target 名称 hydration，没有创建计划时选择既有 Agent 的表单、跨 Host Agent 选择或 `target: { type: "agent", agentId }` 创建语义；fork 现有 Agent 目标能力继续保留。
- 上游未实现 Status Bar/`status.summary`、usage ledger、多 Host 汇总、共享侧边栏 Pin 或只读聊天分享的等价功能。本轮没有下线 fork 能力；Agent turn completion 同时采用上游 usage 合并以保留 context window，并保留 fork 的非历史 usage ledger 入队。

### 2026-07-29: `upstream/main` `504b687f8`

- 合入上游聊天历史起点分页与图片预览稳定性、Codex 最新计划审批、CLI Agent/schedule thinking 配置、上滑收起键盘、Grok quota 和 Claude 1M context 修复，以及 Linux AppImage/CI 改进。
- 上游的计划 `--thinking` 已与 fork 的创建目标并存；它没有提供创建计划时选择已有 Agent 的表单、跨 Host 选择或 `target: { type: "agent", agentId }` 语义，故保留 fork 现有 Agent 目标能力。
- 上游没有新增 Status Bar/`status.summary`、usage ledger、多 Host 聚合、共享侧边栏 Pin 或聊天分享的等价实现；这些 fork 能力继续保留。本轮没有需要下线的 fork 功能。
- 聊天分享导出已接入上游时间线页的 `hasAuthoritativeBaseline` 协议字段：导出的首个 tail 页面不假定本地快照权威，后续同一历史 epoch 的 older 页面沿用已建立基线，保持完整历史导出的分页行为。

### 2026-07-28: `upstream/main` `cbbf6c168` / `v0.2.3`

- 合入上游工作区创建时携带本地文件与共享状态、项目/工作区目录打开、完整聊天历史分页、父 Agent 生命周期、Codex 项目 skills 发现、Relay 性能与多项 UI/稳定性修复。
- 上游计划表单的 `targetKind: "agent"` 仍只覆盖现有 Agent 目标的编辑/heartbeat 路径；创建计划时没有选择已有 Agent 的入口、跨 Host 选择 UI 或同等提交语义。因此保留 fork 的创建目标分段控件、Agent 选择和 `target: { type: "agent", agentId }` 创建路径。
- 上游没有新增 Status Bar/`status.summary`、usage ledger、多 Host 聚合或共享侧边栏 Pin 的等价实现；这些 fork 能力继续保留。

### 2026-07-27: `upstream/main` `1a1ff882` / `v0.2.2`

- 合入上游 Markdown 长行换行、并排编辑文件的焦点修复、Android 流式对话位置稳定性、桌面退出时停止 daemon，以及 Claude 5 上下文窗口选择修正。
- 上游没有新增 Status Bar/`status.summary`、usage ledger、多 Host 聚合或计划任务选择已有 Agent 的等价实现；fork 对应能力继续保留。
- Status Bar Pin 仍只消费侧边栏 workspace 的 `pinnedAt`、列表投影和 `setWorkspacePinned` API；不恢复独立 Pin 协议或数据结构。
- 2026-07-28 例行同步确认上游端点没有新提交，无需再次 merge 或重新构建。

### 2026-07-22: `upstream/main` `4a4556f49`

- 合入上游 Markdown 行渲染与聊天文件链接行定位修复、侧边栏初始渲染优化、时间线 catch-up 稳定性、工作区服务控制、最近提交历史与桌面终端 hooks 恢复。
- Composer 容器采用上游动画静态样式，同时保留 fork Status Bar 的底部 inset；计划任务已有 Agent、Status Bar 汇总、usage ledger 和 Codex usage 归一化继续保留。

### 2026-07-21: `upstream/main` `aa6384bab`

- 合入上游 workspace 级跨 Provider 会话导入、完整 workspace/Agent 历史同步、网页端直接编辑 workspace 文件、项目首次 workspace 前重命名、服务端端口分配以及 Pi/Codex/OpenCode 修复。
- 上游文件面板已提供 Markdown Preview/Source 分段切换，并与实时文件刷新、网页编辑、保存冲突处理和 Vim 键位集成；采用其实现并删除 fork 旧的独立切换 UI/文案，保留带行号定位时默认 Source 的行为。
- 上游仍未提供计划任务选择已有 Agent 的等价入口，继续保留 fork 的表单、CLI 和持久化语义。
- Status Bar、usage ledger、多 Host 聚合和 Codex usage 归一化仍保留；Codex turn 结束时同时清理上游 client-message 状态和 fork turn usage 状态。

### 2026-07-19: `upstream/main` `c9bcfa763`

- 合入上游的安全自动审批默认值、闲置 Agent runtime 回收、重连恢复、会话时间线同步、Command Center 模型切换和 workspace/CLI 语义更新。
- 上游已通过 `callerAgentId` 将受管 `paseo run` 的调用上下文交给 daemon，由服务端统一解析 workspace 与父子关系；采用该模型，删除 fork 旧的客户端 workspace 查询与 `agentWorkspaceInheritance` capability gate。
- 上游计划任务表单仍未提供选择已有 Agent 作为执行目标的等价入口，保留 fork 的表单、CLI 与持久化语义，并合并上游 cron cadence 校验。
- Status Bar、usage ledger、多 Host 聚合和 Codex 使用量修正仍为 fork 能力，继续保留并与上游的会话恢复、Pin 可见性和 timeline 同步组合。

### 2026-07-18: `upstream/main` `a1de743ef`

- 合入上游 `v0.2.0-beta.1`、Hub、Forge、多 Host 同步流量优化、侧边栏及桌面更新改进。
- 采用上游“每个新增目录独立项目”的 workspace provisioning 模型；保留 fork 的活跃 workspace 优先于已归档同路径记录的回归测试。
- 上游计划表单没有等价的“创建计划时选择已有 Agent”入口，保留 fork 的表单、CLI 与持久化语义。
- Status Bar、usage ledger、多 Host 聚合和 Task Agent workspace 继承均保留；Session context 以新的上游目录/时间线同步为底座，重新接入 Status Summary 刷新与推送。

### 2026-07-17: `upstream/main` `9f5f5fce6`

- `git fetch upstream --prune` 后，上游端点仍是当前 fork 已合入的祖先，没有新增提交需要 merge，也没有需要以下游实现替代的同等功能。
- 计划任务选择已有 Agent 仍没有上游等价实现，保留 fork 的表单、CLI 与持久化语义。
- Status Bar 不再维护独立 session Pin：已改为直接复用侧边栏 workspace 的 `pinnedAt`、列表投影与 `setWorkspacePinned` API；旧 `status.session_pins` 协议、client API、server store 和 capability gate 已删除（`a2c93f414`）。Pin 列表进一步复用侧边栏 workspace entry 与行内容，标题、状态、分支和项目元数据保持一致（`54c6ebf04`）。

### 2026-07-16: `upstream/main` `04e893417`

- 合入上游的桌面 stale daemon lock 恢复、子 Agent 可见性、工具调用展示、desktop/sidebar 布局和项目打开流程修复。
- 上游没有实现 Status Bar 汇总与多 Host pin、既有 Agent 计划任务、GPT-5.5/GPT-5.6 usage 定价、Markdown 预览/原始内容切换或 Task Agent workspace 继承，fork 对应实现全部保留。
- 冲突处理采用上游的 `NavigateToWorkspaceInput` draft target API，删除 fork 旧的 `openDraftTab` 路径；保留 Markdown 切换、Status Bar 底部 inset、usage ledger 终态清理，并与上游 agent run settle 逻辑组合。

## 变更清单

### 1. 全局 Status Bar 与状态汇总

**状态**：fork 核心能力，持续演进中。主要提交：`0319c4a4f`、`242ba12b2`、`c6b9dca11`、`a01e9f27a`、`73ab4efa7`、`74438fc8`、`d8b5e63c8`、`611d1b093`、`51798b7ff`、`a2c93f414`、`54c6ebf04`。

**用户可见行为**：

- 底部全局 Status Bar 展示 token、费用、运行/需要注意/最近会话，并提供会话导航。
- 按 host 获取 `status.summary`；客户端可合并多个已连接 host 的信息，并在会话/历史项显示 host。状态栏的 Pin 直接复用侧边栏 workspace 的 `pinnedAt`、列表投影、完整 workspace entry 和 `setWorkspacePinned` API，因此两处展示信息及置顶/取消置顶行为一致。
- 会话以一级 Agent 聚合；子 Agent 的运行或等待状态汇总到根 Agent，避免大量子 Agent 淹没列表。
- 历史只显示当前已加载集合中的一级、非 `closed` Agent；支持刷新、workspace Pin 和紧凑/桌面布局。
- 空闲与运行中使用同一状态栏结构；错误目前只显示计数，不新增错误会话面板或旧 RPC fallback。

**关键边界与冲突热点**：

- 协议/SDK：`packages/protocol/src/messages.ts`、`packages/client/src/daemon-client.ts`、`packages/client/src/index.ts`。
- 服务端：`packages/server/src/server/usage-ledger/`、`packages/server/src/server/status-summary/`、`packages/server/src/server/session.ts`、`packages/server/src/server/websocket-server.ts`、`packages/server/src/server/agent/agent-manager.ts`。
- 客户端：`packages/app/src/status-summary/`、`packages/app/src/app/h/[serverId]/_layout.tsx`、`packages/app/src/contexts/session-context.tsx`。

**同步规则**：

- 若上游实现 `status.summary` 或 Status Bar，先比较协议名称、feature gate、payload 和持久化边界。上游协议结构优先；将本 fork 的 usage ledger、root-agent 聚合、多 host 展示、pin 和导航逐项迁移过去。
- 保留 `server_info.features.statusSummary` 的单一 capability gate；不要回退为 client 对旧接口的 fan-out。
- 不新增 Status Bar 专用的 Pin 数据、RPC 或 capability gate。所有 Pin 都以侧边栏 workspace 为权威，状态栏仅消费共享列表投影，并通过同一 workspace Pin controller 写入。
- 上游若只实现 UI 而无相同的 daemon summary/usage ledger，不能直接替换服务端链路。
- 必跑：status-summary 相关 Vitest、`packages/app/e2e/status-bar-running-sessions.spec.ts`、`npm run typecheck`。

**设计与审计依据**：`.codestable/roadmap/global-status-bar/` 和 `.codestable/features/` 下的 status-bar / status-summary 产物。

### 2. 计划任务选择已有 Agent

**状态**：fork 功能。主要提交：`231d25f9c`、`c7132c197`。

**用户可见行为**：计划任务表单可以选择已有 Agent 作为执行目标；CLI schedule 创建参数与表单行为保持一致。

**关键文件**：

- `packages/app/src/components/schedules/schedule-form-sheet.tsx`
- `packages/cli/src/commands/schedule/create.ts`
- `packages/cli/src/commands/schedule/shared.ts`

**同步规则**：

- 如果上游已支持在计划中选择/复用已有 Agent，直接采用上游的数据模型、表单和 CLI 参数，删除本 fork 的同等分支，不维护两套选择语义。
- 若上游仅增加 UI、但没有等价 CLI 或持久化语义，先保持本 fork 实现并对齐字段命名，再补齐测试。
- 必跑：schedule form 目标测试、`packages/cli/src/commands/schedule/shared.test.ts`、`npm run typecheck`。

### 3. Codex 模型价格表

**状态**：fork 维护项。主要提交：`40cc55580`（GPT-5.5）、`7bdd79b17`（GPT-5.6）、`21ac8b8fe`（Codex usage accounting）。

**行为**：为 Codex usage 计费增加 GPT-5.5 和 GPT-5.6 定价；将 Codex app-server 的 thread 累计 token usage 归一化为 foreground turn 内的单调累计值，避免多模型调用、重复通知、resume 或 native counter reset 导致 Status Bar 费用少记。

- 2026-07-30 按 `Wei-Shaw/sub2api` 公开 model pricing catalogue 更新精确变体：`gpt-5.6-sol` 为 `$5/$0.5/$30`、`gpt-5.6-terra` 为 `$2.5/$0.25/$15`、`gpt-5.6-luna` 为 `$1/$0.1/$6`（输入/缓存输入/输出，每百万 token），并补齐 GPT-5.4/GPT-5.5 `-pro` 变体。Status Bar 仍是本地 token 估算；无法反映 sub2api 实例的组倍率、账号倍率、私有模型映射或实际扣费，且价格更新不回填既有 ledger 记录。

**关键文件**：

- `packages/server/src/server/agent/providers/codex-app-server-agent.ts`
- `packages/server/src/server/agent/providers/codex-app-server-agent.test.ts`

**同步规则**：

- 上游更新同一价格表时，以其模型标识和金额为准，逐项核对 GPT-5.5 / GPT-5.6 是否已覆盖，避免重复 case 或错误覆盖顺序。
- 上游调整 Codex token usage payload 或 ledger 记账时，保留 turn 内累计、native turn id 校验和旧 payload 的单次快照兼容路径；修复不回填既有 ledger 数据。
- 必跑：`codex-app-server-agent.test.ts`、usage ledger 与 Status Bar usage 目标测试。

### 4. 桌面端本地打包兼容

**状态**：fork 打包修复，主要来自 `036d6108b`、`cafe5188a`。

**行为**：保留 macOS desktop 打包所需的 entitlements 与 daemon packaging 测试，并允许 desktop 开发环境在 React DevTools 下载失败时继续运行。

**关键文件**：

- `packages/desktop/build/entitlements.mac.plist`
- `packages/desktop/build/entitlements.mac.inherit.plist`
- `packages/desktop/src/main.ts`
- `packages/desktop/src/daemon/desktop-packaging.test.ts`

**同步规则**：

- 上游调整 Electron 版本、签名、entitlements 或 daemon 打包时，先保留本 fork 的 macOS 打包约束，再按上游机制重写；不要只解决 TypeScript 冲突后跳过实际 arm64 DMG 验证。
- 必跑：desktop packaging 目标测试和 macOS arm64 打包/启动冒烟。
- 本地构建前删除同版本的 `Paseo-*.dmg`、`*.blockmap`、`*.zip` 和 `release/mac-arm64/`，防止误将旧产物当成新包上传。
- 上传前检查 DMG 修改时间、SHA-256 和打包后的 `app-dist` 是否包含本次功能；OSS 使用 `版本/commit SHA` 的不可变路径，不能只覆盖同名 URL。

### 5. Task Agent CLI workspace 继承

**状态**：已由上游实现替代；fork 不再维护重复的客户端解析路径。

**行为**：Paseo-managed Agent 内的 `paseo run` 将 `PASEO_AGENT_ID` 作为 `callerAgentId` 发送给 daemon，由服务端复用与 agent-scoped MCP 相同的 workspace 与父子关系策略，不再为每个 Task Agent 创建侧边栏条目。外部自动化可使用显式 `--workspace` 选择现有 workspace；daemon 不会按 cwd 合并所有 workspace。

**关键文件**：

- `packages/cli/src/commands/agent/run.ts`
- `packages/client/src/daemon-client.ts`
- `packages/protocol/src/messages.ts`
- `packages/server/src/server/session.ts`
- `skills/paseo/SKILL.md`

**同步规则**：

- 同 cwd workspace 可以合法并存，不能只凭路径自动合并或在 UI 层去重。
- Agent 内 CLI 必须将 `PASEO_AGENT_ID` 传递为 `callerAgentId`，由 daemon 解析调用者 workspace；无法解析时显式失败，不能静默创建。
- 上游变更 caller context 或 workspace 创建 API 时，优先采用其协议和服务端策略，不恢复客户端查询或旧 capability gate。
- 必跑：CLI run、CLI workspace precedence 与 session 目标测试。

### 6. Markdown 预览切换原始内容

**状态**：已由上游实现替代。

**行为**：上游文件面板提供 Markdown Preview/Source 分段切换，并集成网页编辑、实时文件刷新、保存冲突处理和 Vim 键位。切换状态仅作用于当前文件；fork 保留带行号定位的 Markdown 链接默认打开 Source 视图，以保留定位高亮。

**关键文件**：

- `packages/app/src/file-pane/pane.tsx`
- `packages/app/src/components/file-pane-render-mode.ts`
- `packages/app/src/i18n/resources/*.ts`

**同步规则**：

- 采用上游文件面板的状态模型和控件位置；带行号定位时默认 Source 的行为必须保留。
- 不恢复 fork 的图标切换 UI、独立文案或旧文件读取路径。
- 必跑：文件面板、`file-pane-render-mode.test.ts`、`resources.test.ts`、`npm run typecheck`。

### 7. 只读聊天分享

**状态**：fork 功能。主要提交：`7c9a99eb3`、`1ecfe1612`、`6f6d0f18d`、`425fda60e`。

**行为**：聊天消息菜单支持异步分享，用户可选择从任一用户消息开始导出完整历史；客户端上传 JSON 后复制只读访问链接。Threadshare 是独立仓库 `team-harness/threadshare`，拥有 `threadshare-history@v1` 协议、受限 History API、只读 Viewer、Codex/Claude CLI 适配和云部署模板。Paseo 只是该协议的生产者，不再承载服务端、Web 或云凭证。

- 2026-07-30：新版 Paseo 与 Threadshare CLI 输出通用的 `threadshare-history@v1`；Threadshare 新服务部署在 `https://cloud-thread.team-harness.com`，服务端单向兼容旧 Paseo v1 JSON。原 `https://paseo-share.team-harness.com` 服务保持原版本，不作为新协议端点。
- 2026-07-30：Threadshare CLI 以公开 npm 包 `@team-harness/threadshare` 发布；默认服务为 `https://cloud-thread.team-harness.com`，也可通过 `--url` 或 `THREADSHARE_URL` 覆盖。独立仓库随包提供 Codex、Codex Cloud（`CODEX_HOME`）和 Claude 使用 Skill。
- 2026-07-30：Codex App Server 创建的子 Agent 使用其自身 child-thread timeline，并非独立的 Paseo Agent 持久化记录。只读子 Agent 面板复用聊天分享 UI，但通过 `fetchProviderSubagentTimeline` 分页加载完整 child-thread 历史后再导出；分叉和继续聊天仍保持不可用。

**关键文件**：

- `packages/app/src/chat-share/history.ts`
- `packages/app/src/chat-share/upload.ts`
- `packages/app/src/agent-stream/view.tsx`
- `https://github.com/team-harness/threadshare`

**同步规则**：

- 上游若提供等价聊天分享，优先采用其导出协议、上传 API 和 Viewer URL 结构；迁移时保留全量历史分页、分享起点选择和异步 UI 状态。独立 Threadshare 服务仍应作为其他 Agent 客户端的通用实现。
- 导出的时间线页必须跟随上游 `TimelinePage` 协议字段，尤其是 history epoch 与权威基线语义，不能把客户端当前已加载的局部消息当作完整历史。
- Codex 子 Agent 分享不得按普通 Agent ID 读取本地持久化文件；必须使用上游 provider-subagent timeline API，并在 epoch 重置、游标过期或 timeline gap 时中止分享。
- 必跑：聊天分享导出/上传目标测试、时间线分页测试、`npm run typecheck`。

## 同步上游操作清单

1. 先确认工作区干净或把本地未提交改动隔离；当前待提交的变更必须单独处理，不能混入上游 merge。
2. `git fetch upstream`。GitHub 网络不通时，先检查本机代理后再配置当前命令/会话使用代理。
3. 阅读 `git log --oneline HEAD..upstream/main`，并对照本文件的“关键文件”和“同步规则”。
4. 合并 `upstream/main`。冲突优先级：协议/持久化 -> 服务端 -> client SDK -> Status Bar UI -> schedule UI/CLI -> desktop 打包 -> 测试与文档。
5. 对每个上游同等能力做明确决定：`采用上游并删除 fork 重复代码`、`上游为基础迁移 fork 扩展`、或 `保留 fork 实现`。把决定写回本文件。
6. 执行受影响区域的目标测试、`npm run format`、`npm run lint -- <changed-files>`、`npm run typecheck`；涉及桌面端时额外构建 macOS arm64 安装包。
7. 更新“比较基线”、新增/修改提交号和同步日期，再提交 merge 结果。

## 新条目模板

```markdown
### {能力名称}

**状态**：fork 功能 | fork 修复 | 待提交 | 已由上游替代。
**提交**：`{sha}`。
**行为**：{用户可见或运行时变化}。
**关键文件**：`{path}`。
**同步规则**：{上游等价时的取舍、不可破坏的兼容/数据约束}。
**验证**：`{目标测试或构建命令}`。
**最近同步判断**：{日期、上游版本、最终决定}。
```
