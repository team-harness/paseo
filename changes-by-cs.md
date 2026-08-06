# Fork Change Ledger

本文件记录 `team-harness/paseo` 相对原作者仓库的产品和运行时改动，用于后续同步上游时快速判断：保留、迁移到上游实现，还是下线本 fork 的重复代码。

这不是发布说明，也不是完整 Git diff。每次增加会影响运行时行为、协议、持久化数据或桌面打包的 fork 改动时，必须在这里补一条记录。

## 比较基线

- Fork remote：`origin` -> `git@github.com:team-harness/paseo.git`
- 上游 remote：`upstream` -> `git@github.com:getpaseo/paseo.git`
- 初始记录基线：`upstream/main` = `f2ebac931c60ed423968f1aa07ba78c0a0b2776c`，记录于 2026-07-14。
- 最近同步基线：`upstream/main` = `fb5cfb9fb90ac1957fe09653bce2667bfe1ec070`，同步于 2026-08-06。
- 最近同步 merge commit：本次同步提交（第二父提交为 `fb5cfb9fb90ac1957fe09653bce2667bfe1ec070`）。

同步时以 `upstream/main` 为原作者来源，不要把 `origin` 误认为上游。

## 总体决策原则

1. 上游已经提供同等能力时，以**上游实现为准**。删除或迁移本 fork 的重复实现、测试和文案，不保留双路径。
2. 对 Status Bar、持久化数据和协议改动，先保证数据/协议兼容，再处理 UI 冲突。不得用旧 RPC 拼装新能力的降级路径。
3. 对现有 Agent 的 `workspaceId`、usage ledger、session pin 等持久化数据，不能直接删除记录；先检查迁移和归属关系。
4. `.codestable/` 是 fork 的工程流程和审计资产，不改变 Paseo 运行时行为。上游若也引入同名流程文件，保留双方必要约束，避免用上游版本整目录覆盖。
5. 解决冲突后，更新本文件中的“同步状态”和“上游等价实现”判断，并在对应区域跑目标测试。

## 最近同步判断

### 2026-08-06: `upstream/main` `fb5cfb9fb` / `v0.3.0-beta.2`

- 合入上游终端失焦后保持输出订阅、Host 连接选择持久化、忽略 Git ignored workspace 建议、Pi 委派任务生命周期、语音空闲时释放 audio session、韩语本地化和网站 beta 下载入口。
- 侧边栏采用上游 checks 显示偏好、运行中 Service 摘要、统一状态色与 `SyncedLoader` 尺寸修正；脱离项目分组的 Pinned/状态行继续在 Meta Row 首项显示项目名，运行中继续使用 fork 的 `SyncedLoader` 形态而非呼吸圆点。loader 颜色改为消费上游统一的 running 状态色。
- 能力决策：继续保留 fork 的 Status Bar/usage ledger/多 Host 汇总、计划任务选择既有 Agent、Codex 定价与 usage accounting、Threadshare 分享、Host 常用 Prompt、对话选区引用、跨 File/Changes Review Comments、工作区内聊天标签切回跟随最新消息、固定签名桌面/Web Server 分发，以及独立 Android 安装身份与本地 APK 构建。本轮没有上游等价能力可下线。

### 2026-08-05: `upstream/main` `0b624b558` / `v0.3.0-beta.1`

- 合入上游新 worktree 默认跟随 upstream branch、Android 键盘与 Composer 修复、原生 IME composition 修复、移动端菜单与终端交互修复、Git watcher 防停滞、assistant 时间线顺序修复、Provider 快照条件缓存和 WebSocket 启动性能优化，以及桌面包排除开发产物。
- 侧边栏采用上游集中式 `HostBadge`、菜单 sheet 和 press highlight；状态分组与 Pinned 行继续把项目名作为 Meta Row 首项，运行中继续使用 fork 的 `SyncedLoader`。Provider 快照采用上游 hash/cache 链路，Session Context 不再主动预取快照，但保留独立的 `status.summary` 刷新和推送订阅。
- 能力决策：保留 fork 的 Status Bar/usage ledger/多 Host 汇总、计划任务选择既有 Agent、Codex 定价与 usage accounting、Threadshare 聊天分享、Host 常用 Prompt、对话选区引用和跨 File/Changes 的 Review Comments；桌面端在上游包体排除规则上继续保留固定本地签名、entitlements 和标准 APFS DMG；Task Agent workspace 继承与 Markdown Preview/Source 继续使用上游实现。本轮没有重复能力下线。

### 2026-08-04: `upstream/main` `74dea3845` / `v0.2.5`

- 合入上游原生移动终端重构、Android 键盘与终端尺寸归属修复、assistant 选区语义化复制、聊天滚动位置恢复与最近会话保活、Hub execution MCP、OpenCode 活跃回合 context usage 更新，以及网站 Hub/连接文档。
- 侧边栏采用上游的显示偏好、共享菜单、Meta Row、check/script 摘要和行背景模型。脱离项目分组的 fork 行仍显示项目名，但项目名迁入 Meta Row 的首项，与 Host、PR、checks 和 scripts 共用第二行；运行中状态继续使用 `SyncedLoader`，创建/归档继续使用普通加载指示器。
- 聊天分享接入上游的 retained turn presentation 和 assistant 选区复制表面，仍在分享前加载权威完整历史、选择起点、脱敏并执行 5 MiB 约束。上游仍未实现 Status Bar/`status.summary`、usage ledger、多 Host 汇总、共享侧边栏 Pin、计划任务创建时选择既有 Agent、Codex 定价与 usage accounting、Threadshare 分享或常用 Prompt 集合；上述 fork 能力全部保留，本轮没有重复能力下线。

### 2026-08-03: `upstream/main` `5d15e40a2` / `v0.2.5`

- 合入上游原生子 Agent 工作区活跃状态、跨平台 Git 观察与 daemon 级 Git 进程限流、旧 daemon 时间线去重、聊天大纲、全局路由工作区保活、移动端粘贴图片、侧边栏 Host 标识和 Nix 桌面图标修复。
- 聊天分享与上游聊天大纲、时间线 detached/tail 导航组合；分享继续加载权威完整历史并在客户端上传前执行脱敏和体积约束。桌面端采用上游图标资源路径，同时保留 fork 的 macOS entitlements、本地签名和标准 APFS DMG 约束。
- 上游仍未实现 Status Bar/`status.summary`、usage ledger、多 Host 汇总、共享侧边栏 Pin、计划任务创建时选择既有 Agent、Codex 定价与 usage accounting 或 Threadshare 分享。上述 fork 能力全部保留，本轮没有重复能力下线。

### 2026-08-02: `upstream/main` `048b82f2a` / `v0.2.5`

- 合入上游时间线提交、分页、resume 和图片稳定性重构，完整原生子 Agent 对话、运行中 Agent 分叉、ACP 权限选择与共享 auto-accept、Provider 进程退出恢复、Command Center 稳定性、折叠项目状态徽标及 HTML 文件预览；浏览器与桌面 E2E 目录同时采用上游的新分层。
- 文件面板完全采用上游统一的 Markdown/HTML Preview/Source 状态模型；删除 fork 已无调用的 Markdown 专用 render-mode helper。上游实现本身在带行号定位时进入 Source，因此不再保留重复状态路径。
- 聊天分享接入上游新的 `TurnPresentation`、运行中分叉和时间线 reducer 输入；已完成 turn 继续显示分享入口，Provider 子 Agent 继续通过专用 timeline API 加载完整历史。分享分页明确传入空的 sending client-message 集合，避免把本地 composer 状态混入只读导出。
- 上游仍未实现 Status Bar/`status.summary`、usage ledger、多 Host 汇总、共享侧边栏 Pin、计划任务选择既有 Agent、Codex 定价与 usage accounting 或 Threadshare 分享。上述 fork 能力全部保留；没有其他重复能力下线。

### 2026-08-01: `upstream/main` `70ed70d36` / `v0.2.5`

- 合入上游 Command Center Agent 控制、项目自定义图标、按需 Relay、Claude SDK 子 Agent、技能选择安装、OpenCode 稳定性、移动侧栏手势和 Darwin Nix 桌面包支持。
- `chatShare` 与上游新增的 `projectCustomIcon` 是相互独立的协议 capability；本轮在协议 schema 和服务端 feature advertisement 中同时保留，客户端继续按各自 capability gate 使用。
- 跟随上游删除已淘汰的 `workspaceGithubClone` 和 `agentWorkspaceInheritance` feature gate；workspace clone 使用项目创建链路，Agent 内 CLI workspace 继承继续使用上游 caller context，不恢复 fork 的旧客户端解析路径。
- 上游没有实现 Status Bar/`status.summary`、usage ledger、多 Host 汇总、共享侧边栏 Pin、计划任务选择既有 Agent、Codex 定价与 usage accounting 或 Threadshare 分享。上述 fork 能力全部保留，没有下线重复实现；provider subagent 仍通过只读 Agent stream 加载完整历史后分享。

### 2026-07-31: `upstream/main` `b6f1274f4` / `v0.2.5`

- 合入上游文件查看器冲突状态修复：区分磁盘内容变化与文件删除，统一文件订阅和读取顺序，避免陈旧读取覆盖删除状态；清理已恢复的冲突，并允许重试初始读取或只读预览错误。同步采用上游新增的 live-file/editor 状态模型、文件冲突 E2E 和多语言文案。
- 同步上游重写后的贡献指南、QA 与协议兼容文档，以及 issue/discussion 引导调整。
- 上游未触及 Status Bar/`status.summary`、usage ledger、多 Host 汇总、共享侧边栏 Pin、计划任务选择既有 Agent、Codex 定价或 Threadshare 分享。本轮全部 fork 能力继续保留，没有下线重复实现；Paseo producer 侧的工具凭据脱敏保持在上传边界。

### 2026-07-30: `upstream/main` `4e6f759da` / `v0.2.5`

- 合入上游 Linux 桌面包启动修复：AppImage 运行时直接启用 `--no-sandbox`，删除会误判 `.deb` / `.rpm` sandbox helper 的通用检测层；同时同步全 workspace `0.2.5` 版本、lockfile 签名与 Nix hash。
- 上游没有触及 macOS entitlements、本地 DMG 标准布局或 React DevTools 下载容错；fork 桌面打包兼容继续保留，并以当前 `0.2.5` 主进程、daemon 和 app bundle 构建 arm64 DMG。
- 上游没有新增 Status Bar/`status.summary`、usage ledger、多 Host 汇总、共享侧边栏 Pin、计划任务选择既有 Agent 或只读聊天分享的等价能力。本轮没有下线 fork 功能。

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
- 必跑：status-summary 相关 Vitest、`packages/app/e2e/browser/status-bar-running-sessions.spec.ts`、`npm run typecheck`。

**设计与审计依据**：`.codestable/roadmap/global-status-bar/` 和 `.codestable/features/` 下的 status-bar / status-summary 产物。

### 2. 计划任务选择已有 Agent

**状态**：fork 功能。主要提交：`231d25f9c`、`c7132c197`。

**用户可见行为**：计划任务表单可以选择已有 Agent 作为执行目标；CLI schedule 创建参数与表单行为保持一致。新建和编辑表单的名称、Prompt 与最大运行次数支持中文等 IME composition。已有 Agent 的计划不再只显示 cadence，可以编辑名称、Prompt 和最大运行次数；旧 heartbeat cadence 无法映射到当前编辑器时，保存其他字段不会强制改写 cadence。

**关键文件**：

- `packages/app/src/components/schedules/schedule-form-sheet.tsx`
- `packages/app/src/schedules/schedule-form-model.ts`
- `packages/cli/src/commands/schedule/create.ts`
- `packages/cli/src/commands/schedule/shared.ts`

**同步规则**：

- 如果上游已支持在计划中选择/复用已有 Agent，直接采用上游的数据模型、表单和 CLI 参数，删除本 fork 的同等分支，不维护两套选择语义。
- 若上游仅增加 UI、但没有等价 CLI 或持久化语义，先保持本 fork 实现并对齐字段命名，再补齐测试。
- 已有 Agent 计划必须保留 Prompt 编辑入口。更新旧 heartbeat 时 cadence 是可选字段；用户没有明确选择新 cadence 时，不得用默认 cron 覆盖原值。
- Web/Electron 的受控输入只在 composition 提交后写入表单模型，不能在中文候选过程中用父组件状态覆盖原生输入值。
- 必跑：`schedule-form-model.test.ts`、`schedules-edit-model-hydration.spec.ts`、`packages/cli/src/commands/schedule/shared.test.ts`、`npm run typecheck`。

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

### 4. 桌面端与 Web Server 本地打包兼容

**状态**：fork 打包修复，主要来自 `036d6108b`、`cafe5188a`。

**行为**：保留 macOS desktop 打包所需的 entitlements 与 daemon packaging 测试，并允许 desktop 开发环境在 React DevTools 下载失败时继续运行。同步发布两个用途不同的产物：仅支持 Apple Silicon 的固定本地签名 APFS DMG，以及供非 arm64 主机和浏览器用户升级的 Web + Paseo Server tar.gz。承载用户会话的构建机上只做离线产物校验；发布流程不启动打包后的 Paseo 或 Server，也不控制当前运行的主 daemon。

Web + Server 归档沿用官方 Docker 的 workspace pack 链路，包含 `highlight`、`relay`、`protocol`、`client`、`server` 和 `cli` 六个 fork npm 包；server 包内嵌同版本 Web UI。归档不携带构建机的 arm64 `node_modules`，目标主机使用 Node.js 22/npm 为自身架构安装外部依赖。

**关键文件**：

- `packages/desktop/build/entitlements.mac.plist`
- `packages/desktop/build/entitlements.mac.inherit.plist`
- `packages/desktop/src/main.ts`
- `packages/desktop/src/daemon/desktop-packaging.test.ts`
- `scripts/build-web-server-release.mjs`
- `scripts/build-daemon-web-ui.mjs`
- `shedule-synup.md`

**同步规则**：

- 上游调整 Electron 版本、签名、entitlements 或 daemon 打包时，先保留本 fork 的 macOS 打包约束，再按上游机制重写；不要只解决 TypeScript 冲突后跳过实际 arm64 DMG 验证。
- 上游 GitHub Release 的 x64 tar.gz 是 Linux Electron 桌面包，不视为 Web + Server 等价产物。若上游改变 Docker/npm 发布机制，保持六个内部 package 同批安装和 server 内嵌 Web UI，再按新机制迁移。
- 必跑：desktop packaging 目标测试、macOS arm64 DMG/签名/包内容离线校验，以及 Web + Server 归档校验和临时 npm prefix 安装。需要 daemon 或 packaged desktop 端到端冒烟时，改在不承载用户会话的独立主机或容器执行。
- 本地构建前删除同版本的 `Paseo-*.dmg`、`*.blockmap`、`*.zip` 和 `release/mac-arm64/`，防止误将旧产物当成新包上传。
- 发布流程禁止运行 packaged desktop smoke 以及 `paseo daemon start`、`stop`、`restart`。临时 `PASEO_HOME` 只隔离数据，不保证控制命令不会连接默认端口 `6767`；构建前和上传前只读核对主 daemon 的监听 PID 与 `/api/health`，状态变化时中止并报告。
- 两种产物上传到 commit 隔离的 OSS 路径；发布通知必须明确 DMG 仅支持 Apple Silicon，并单列 Web + Server 下载链接和 Node.js 22/npm 要求。
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

**行为**：上游文件面板提供统一的 Markdown/HTML Preview/Source 分段切换，并集成网页编辑、实时文件刷新、保存冲突处理和 Vim 键位。切换状态仅作用于当前文件；带行号定位的链接直接打开 Source 视图，以保留定位高亮。

**关键文件**：

- `packages/app/src/file-pane/pane.tsx`
- `packages/app/src/components/file-pane-render-mode.ts`
- `packages/app/src/i18n/resources/*.ts`

**同步规则**：

- 采用上游文件面板的状态模型、render kind 和控件位置；带行号定位时默认 Source 的行为由上游统一模型负责。
- 不恢复 fork 的 Markdown 专用 helper、图标切换 UI、独立文案或旧文件读取路径。
- 必跑：文件面板、`file-pane-render-mode.test.ts`、`resources.test.ts`、`npm run typecheck`。

### 7. 只读聊天分享

**状态**：fork 功能。主要提交：`7c9a99eb3`、`1ecfe1612`、`6f6d0f18d`、`425fda60e`。

**行为**：聊天消息菜单支持异步分享，用户可选择从任一用户消息开始导出完整历史；客户端上传 JSON 后复制只读访问链接。Threadshare 是独立仓库 `team-harness/threadshare`，拥有 `threadshare-history@v1` 协议、受限 History API、只读 Viewer、Codex/Claude CLI 适配和云部署模板。Paseo 只是该协议的生产者，不再承载服务端、Web 或云凭证。

- 2026-07-30：新版 Paseo 与 Threadshare CLI 输出通用的 `threadshare-history@v1`；Threadshare 新服务部署在 `https://cloud-thread.team-harness.com`，服务端单向兼容旧 Paseo v1 JSON。原 `https://paseo-share.team-harness.com` 服务保持原版本，不作为新协议端点。
- 2026-07-30：Threadshare CLI 以公开 npm 包 `@team-harness/threadshare` 发布；默认服务为 `https://cloud-thread.team-harness.com`，也可通过 `--url` 或 `THREADSHARE_URL` 覆盖。独立仓库随包提供 Codex、Codex Cloud（`CODEX_HOME`）和 Claude 使用 Skill。
- 2026-07-30：Codex App Server 创建的子 Agent 使用其自身 child-thread timeline，并非独立的 Paseo Agent 持久化记录。只读子 Agent 面板复用聊天分享 UI，但通过 `fetchProviderSubagentTimeline` 分页加载完整 child-thread 历史后再导出；分叉和继续聊天仍保持不可用。
- 2026-07-31：Paseo 在生成 `threadshare-history@v1` 时脱敏会话标题、普通消息、thought、todo、activity 以及递归工具输入、输出和错误中的凭据，包括敏感字段、Basic/Bearer/Token Auth、URL 密码及常见 token。字符串化 JSON 通过语法树定位敏感值，不直接用正则改写 JSON 结构，因此不会破坏嵌套 JSON 或改变大整数、高精度数值字面量；token 计数、鉴权状态和说明性认证文本保持原样。脱敏发生在客户端上传前，不依赖 Threadshare 服务端清洗。
- 2026-08-02：上传体不超过 Threadshare 的 5 MiB 限制时保持原样；超过限制时，完整保留用户、assistant 及其他非工具记录，将同一工具调用的状态更新合并为最终状态，只保留工具名称、首次调用时间、请求参数和最终状态，删除已识别工具类型的返回值与错误详情。未来未知 detail 类型无法可靠区分请求和返回，保持原样并交给最终大小检查。压缩后仍超限时在发起网络请求前中止，并提示选择更靠后的用户消息；其他上传失败会显示服务端原因，不再被通用错误吞掉。
- 2026-08-06：Android Metro 将 `jsonc-parser` 定向到可静态分析的 ESM 入口。该包的 UMD 工厂会遮蔽 `require`，导致 release bundle 漏掉 `impl/*` 并在恢复工作区时原生崩溃；本地 APK 构建在 Gradle 前验证实际 Android Metro 图，禁止 UMD 入口并要求完整 ESM 依赖。
- 2026-08-06：Review Comments 与 Host 项目匹配排序不使用 Hermes 尚未实现的 `Array.prototype.toSorted()`；复制数组后使用 `sort()`，保留非变异语义并避免 Android 工作区恢复进入错误边界。

**关键文件**：

- `packages/app/src/chat-share/history.ts`
- `packages/app/src/chat-share/upload.ts`
- `packages/app/src/agent-stream/view.tsx`
- `packages/app/metro.config.cjs`
- `scripts/verify-android-metro-bundle.mjs`
- `https://github.com/team-harness/threadshare`

**同步规则**：

- 上游若提供等价聊天分享，优先采用其导出协议、上传 API 和 Viewer URL 结构；迁移时保留全量历史分页、分享起点选择和异步 UI 状态。独立 Threadshare 服务仍应作为其他 Agent 客户端的通用实现。
- 上游的 assistant 选区复制、聊天滚动恢复和最近会话保活可以作为聊天表面的基础能力，但不能替代完整历史加载、分享起点选择、producer 侧脱敏和上传体积限制。
- 导出的时间线页必须跟随上游 `TimelinePage` 协议字段，尤其是 history epoch 与权威基线语义，不能把客户端当前已加载的局部消息当作完整历史。
- Codex 子 Agent 分享不得按普通 Agent ID 读取本地持久化文件；必须使用上游 provider-subagent timeline API，并在 epoch 重置、游标过期或 timeline gap 时中止分享。
- 分享导出的所有可见文本和工具数据必须在 producer 侧完成凭据脱敏；不能假设 Threadshare API 会清洗正文。字符串化 JSON 必须结构化处理，不能用正则直接改写；同时不能误删 token usage、鉴权状态等非凭据元数据或说明性认证文本。
- 5 MiB 压缩只能损失工具返回与错误详情；用户和 assistant 消息不得截断或改写。若上游或 Threadshare 调整请求大小限制，应以服务端协议常量为准同步 producer 测试，不得通过静默丢弃消息规避限制。
- `jsonc-parser` 在 Metro 中必须使用 ESM 入口；不得恢复默认 UMD 入口或移除 Android Metro 图检查。
- 移动端共享路径不得依赖当前 Hermes 未实现的 `Array.prototype.toSorted()`；排序只读输入时先复制数组。
- 必跑：聊天分享导出/上传目标测试、时间线分页测试、`npm run typecheck`。

### 8. 脱离项目分组的侧边栏行保留项目名

**状态**：fork 修复。提交：`f548d71e0`。

**行为**：工作区标题继续遵循用户选择的 Title/Branch name 偏好。状态分组、侧边栏 Pinned 区和顶部状态栏 Pinned 面板中的工作区脱离了项目父行，因此在主标题下显示项目名；普通项目分组内的子行仍保持单行。

**关键文件**：

- `packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx`
- `packages/app/src/components/sidebar-workspace-list.tsx`
- `packages/app/src/components/sidebar/sidebar-status-list.tsx`
- `packages/app/src/status-summary/status-bar-session-pins.tsx`

**同步规则**：

- 不要通过重置 `workspaceTitleSource` 修复项目上下文；用户选择 Branch name 时，分支仍是主标题。
- 脱离项目分组的行必须把项目名渲染为可见次级文字。项目图标和 accessibility label 不能代替可见文字。
- 次级文字保持单行截断，不能撑宽窄侧边栏或移动端布局。
- 必跑：`status-bar-running-sessions.test.tsx`，以及 `sidebar-model-b.spec.ts` 的状态分组场景和 `sidebar-workspace-pin-shortcut.spec.ts` 的 Pinned 场景。

**最近同步判断**：2026-08-06 合入上游 `fb5cfb9fb` 后，采用 checks 显示偏好、运行中 Service 摘要和统一状态色；脱离项目分组的项目名继续位于 Meta Row 首项。运行中状态保留 fork 的 `SyncedLoader`，并使用上游统一的 running 状态色，没有恢复呼吸圆点。

### 9. 常用 Prompt 集合

**状态**：fork 功能。提交：`947f4cbae`、`3b1dc3e0a`。

**行为**：Composer 工具栏提供 Host 级常用 Prompt 集合，支持搜索、新建、编辑、删除，并把 Prompt 精确插入当前选区后恢复输入焦点；插入不会自动发送。集合由 daemon 持久化到 `$PASEO_HOME/prompt-library.json`，连接同一 Host 的浏览器、桌面端、移动端和终端共享，项目、工作区和 Agent 不再各自保存。首次打开时若发现旧的客户端本地集合，会询问后幂等合并到当前 Host；合并成功才删除旧 key，取消或失败时保留并可重试。Web/Electron 编辑器保留中文等 IME 的完整 composition，标题和正文不会在候选提交时重复或丢失。

**关键文件**：

- `packages/app/src/prompt-library/`
- `packages/app/src/composer/index.tsx`
- `packages/app/src/composer/input/input.tsx`
- `packages/protocol/src/messages.ts`
- `packages/client/src/daemon-client.ts`
- `packages/server/src/server/prompt-library/`
- `packages/server/src/server/session/prompt-library-session.ts`
- `docs/data-model.md`

**同步规则**：

- 上游若提供等价 Prompt 集合，采用上游 UI、数据模型和持久化边界，迁移 `$PASEO_HOME/prompt-library.json` 后删除 fork 重复入口，不保留双路径。
- 插入必须替换当前选区、恢复焦点且不自动发送。
- Host 存储写入保持原子和串行；单条损坏记录可以跳过，JSON 或根 envelope 损坏必须阻止普通 CRUD 覆盖，只有显式确认重置可以清空。
- `server_info.features.promptLibrary` 是唯一 capability gate；旧 Host 明确提示更新，不能回退到客户端本地存储。
- 旧 `@paseo:prompt-library` 只用于一次迁移。合并按规范化标题与正文精确去重，保留 Host 顺序；旧 ID 冲突时生成新 ID。损坏的旧本地数据只能在明确确认后单独删除，不能清空 Host 集合。
- `AdaptiveTextInput` 的文字由原生控件持有；Prompt 未提交 draft 不得在每次 `onChangeText` 时触发父组件重渲染，否则 Web/Electron 会提前结束 IME composition。

**验证**：`model.test.ts`、`service.test.ts`、`resources.test.ts`、`prompt-library.spec.ts`（包含 Chromium CDP 中文 IME composition）、`npm run typecheck`、`npm run lint`。

**最近同步判断**：2026-08-05 的上游 `0b624b558` 没有等价常用 Prompt 集合；保留 Host 端存储、旧客户端数据确认迁移和 IME 安全编辑实现。

### 10. 对话选区引用与文件 Review Comments

**状态**：fork 功能。提交：`044802203`。

**行为**：对话中的用户或 Assistant 文本可以按原 Markdown 引用到 Composer，替换当前选区、恢复焦点且不自动发送。文件 Markdown 预览、代码预览和 Source 视图支持对选区留评论；代码与 Source 使用精确行号，Markdown 预览在没有可靠源码映射时只记录选中文字。评论按 workspace 隔离并持久化，File 与 Changes 共用 Review summary，汇总选区评论和 diff 行评论，支持一键复制、逐条删除，以及确认后删除当前汇总中的全部评论。

**关键文件**：

- `packages/app/src/assistant-selection-copy/`
- `packages/app/src/composer/index.tsx`
- `packages/app/src/review/workspace-comments.ts`
- `packages/app/src/review/workspace-comments-store.ts`
- `packages/app/src/review/selection-surface.web.tsx`
- `packages/app/src/review/summary-trigger.tsx`
- `packages/app/src/file-pane/`

**同步规则**：

- 上游若提供等价能力，采用其交互表面和数据模型，迁移已有 workspace 评论后删除 fork 重复入口，不保留双路径。
- 引用必须生成合法 Markdown blockquote，精确替换 Composer 当前选区、恢复焦点且不自动发送。
- 评论必须按 `workspaceId` 隔离；同一 workspace 的 File、Changes、preview/source/diff 需要汇总到同一 Review summary。
- 删除全部必须同时清理 selection 和 diff 两类 store，取消确认时不能改变数据；清空后关闭 summary，并确保刷新后评论不会恢复。
- 没有 AST 级源码映射时，Markdown 预览不得猜测行号；代码预览和 Source 选区继续保留精确范围。
- 自定义选区操作只在 Web/Electron 提供；Native 保留系统复制菜单，不显示不可用入口。

**验证**：`quote.test.ts`、`workspace-comments.test.ts`、`store.test.ts`、`resources.test.ts`、`assistant-selection-copy.spec.ts`、`file-review-comments.spec.ts`、`npm run typecheck`、`npm run lint`。

**最近同步判断**：2026-08-05 的上游 `0b624b558` 仍只有基础选区复制，没有直接引用到 Composer、文件选区 Review Comments 或跨预览与 diff 的 Review summary，保留 fork 实现。

### 11. 工作区内聊天标签切回跟随最新消息

**状态**：fork 修复。

**行为**：同一工作区内从一个 Agent 标签切到另一个标签再切回时，重新选中的聊天回到对话底部并继续跟随最新输出。切换到其他工作区再返回时仍保留用户主动停留的历史阅读位置，不把工作区级隐藏误判为 Agent 标签切换。

**关键文件**：

- `packages/app/src/components/retained-panel.tsx`
- `packages/app/src/agent-stream/strategy-web.tsx`
- `packages/app/src/screens/workspace/workspace-screen.tsx`

**同步规则**：

- Retained panel 必须区分最近一层标签自身的 `localActive` 与包含祖先可见性的 `active`。聊天只在本工作区内由未选中变为选中时回到底部。
- 工作区路由失焦/恢复继续走阅读位置恢复链路；不能因为祖先重新可见就覆盖用户保留的历史位置。
- 回到底部时恢复 follow-output，并在虚拟列表布局稳定后补一次 settle；用户随后的滚轮或滚动条意图仍必须停止跟随。

**验证**：`strategy-web.test.tsx`、`agent-scroll-return.spec.ts`、`npm run typecheck`、`npm run lint`。

**最近同步判断**：2026-08-05 的上游 `0b624b558` 支持 retained chat 阅读位置恢复，但没有区分工作区祖先可见性和同一工作区内 Agent 标签的本地激活语义；保留 fork 修复。

### 12. Fork Android 独立安装与本地 APK 构建

**状态**：fork 分发能力。

**行为**：Android production 使用 `com.teamharness.paseo`，与上游
`sh.paseo` 独立安装；iOS bundle identifier 保持 `sh.paseo`。仓库根目录的
`npm run build:android-apk` 在不启动模拟器、不控制 Paseo daemon 的前提下，
构建包含四种 Android ABI 的 production APK，并校验包名、固定本地签名和
SHA-256。首次联网构建会使用本机代理并填充 SDK、Gradle 与本地 Maven 缓存，
后续支持 `--offline` 冷构建和 `--reuse-native-project` 增量重试。定时同步发布
必须把 APK 与 DMG、Web + Server 包一起上传 OSS，并通过固定群的 bot 通知分发。

**关键文件**：

- `packages/app/app.config.js`
- `scripts/build-android-apk.mjs`
- `scripts/android-local-maven.init.gradle`
- `docs/android.md`
- `shedule-synup.md`

**同步规则**：

- 上游 production Android package id 变化时，继续保留
  `com.teamharness.paseo`；不要连带修改 iOS bundle identifier。
- `packages/app/.secrets/` 下的 release keystore 是本 fork Android 升级身份；
  不得提交、替换或在每次构建时重新生成。构建脚本只能在文件缺失时创建。
- 本地构建必须保持主 daemon 只读，不运行 emulator、`adb install` 或任何
  daemon start/stop/restart 命令。
- 依赖或工具链升级后先联网补齐缓存，再以 `--offline` 验证当前依赖闭包；
  不把构建机的缓存、generated Android project 或 APK 提交进 Git。
- 发布 APK 必须对应当前已提交版本且文件名不能带 `-dirty`。只有逐项确认未跟踪
  文件与 Android 构建无关时才能使用 `--ignore-untracked`；该选项不得隐藏已跟踪改动。
- 每次有上游更新的定时发布都必须构建、校验、上传 APK，并在群通知中同时给出
  DMG、Web + Server 和 APK 三个下载链接。
- APK 的 `versionName` / `versionCode` 必须按 `native-release-version.js` 校验；beta
  后缀保留在发布文件名中，原生 `versionName` 使用三段数字版本。
- APK 公网下载与验证必须使用 bucket CNAME `openweb.bzy.ai`；阿里云 OSS 默认域名会以
  `ApkDownloadForbidden` 拒绝 APK 分发。
- 只有 OSS 对象元数据和公网 URL 均验证成功后，才删除本轮本地 APK、checksum sidecar
  和 Gradle APK 输出。上传失败时保留重试；keystore、SDK、Gradle/Maven 缓存和 generated
  Android project 始终保留。

**验证**：`npm run build:android-apk -- --offline`、`aapt dump badging`、
`apksigner verify --print-certs`、APK ABI 列表、`npm run typecheck`、
`npm run lint`。

**最近同步判断**：2026-08-06 的上游 `fb5cfb9fb` 没有 fork 独立 Android
安装身份或固定本地签名的离线 APK 构建入口，保留本能力。

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
