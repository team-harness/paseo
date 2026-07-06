---
doc_type: feature-design
feature: 2026-07-06-global-status-bar-shell
roadmap: global-status-bar
roadmap_item: global-status-bar-shell
status: approved
summary: 在 host-scoped shell 底部渲染全局状态栏基础壳，展示 usage/activity 摘要并处理 layout、safe area、focus mode
tags: [app, ui, status-summary, status-bar, shell]
---

# global-status-bar-shell feature design

## 0. 术语约定

| 术语                  | 定义                                                                                    | 防冲突结论                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Host status bar shell | `/h/[serverId]/*` host 边界内的底部常驻 chrome，负责占位、基础展示和状态分支。          | 本 feature 新增 UI 壳；不挂 root app layout。                                                       |
| Participating footer  | 作为普通 flex 子节点参与布局的 footer，而不是 absolute/fixed overlay。                  | 用它避免遮挡 workspace composer、settings 底部内容和移动安全区。                                    |
| Summary row/chip      | 状态栏内的一组紧凑文字/状态片段，如 lifetime tokens、today tokens、running、attention。 | 只展示一级摘要；详情弹层和导航归下一条 feature。                                                    |
| Focus mode hidden     | desktop focus mode 下隐藏状态栏，把垂直空间还给工作区。                                 | shell 层读取 `panel-store`，app status store 不处理 focus mode。                                    |
| Bottom chrome inset   | host shell 底部常驻 chrome 占用的高度与 safe-area 归属。                                | 状态栏可见时由 shell 拥有 bottom safe area，主要 leaf 页面需要扣减自己的 bottom safe-area padding。 |

## 1. 决策与约束

### 需求摘要

本 feature 把前置 `app-status-summary-store` 的 view model 渲染到 host-scoped UI 底部：用户在同一个 host 内切换 workspace、agent、sessions、open-project、settings 等页面时，底部能持续看到 token usage 和运行状态摘要。第一版只做 shell 与基础 inline 展示，不做运行中 session 详情弹层、不做点击导航。

成功标准：

- `/h/[serverId]/*` 页面底部有一条低高度状态栏；根级全局路由不显示。
- 状态栏是参与布局的 footer，内容区域被自然压缩，不覆盖 workspace composer、浮层 host 或页面底部操作。
- ready 状态展示 lifetime/today token、cost（有数据时）、running/attention/error 等摘要。
- offline/loading/error/unsupported/empty 数据状态有安静且可验证的 UI 分支。
- desktop focus mode 下隐藏状态栏；compact/mobile 保留安全区背景和底部 inset，且 composer 与状态栏之间不出现重复 safe-area 空带。

明确不做：

- 不实现运行中 session 详情弹层、hover card、bottom sheet 或导航动作；这些归 `status-bar-running-sessions-nav`。
- 不调用 daemon client、provider usage、agent list、timeline 或旧 RPC；只读 `useGlobalStatusBarView(serverId)`。
- 不改 `status.summary.*` 协议、React Query cache 或 push wiring；这些归前置 feature。
- 不挂载到 `packages/app/src/app/_layout.tsx`，不在无单一 `serverId` 的全局路由自动选择 host。
- 不做最终视觉回归矩阵和截图硬化；更广的 compact/desktop polish 归 `status-bar-polish-hardening`，但本 feature 必须给出基础可见状态。
- 不重写所有 leaf 页的 safe-area 策略；本 feature 只处理会与底部状态栏直接冲突的 host bottom consumers，并把长期约定留给 polish/hardening 沉淀。

### 复杂度档位

- `Compatibility = feature-gated downstream`：shell 只消费 app store 的 view model；旧 daemon 的 `unsupported` 分支在 UI 内集中处理，不 fan out fallback。
- `State = derived UI only`：不新增持久状态、不写 React Query、不写 session store。
- `Layout = host-scoped chrome`：改 host route layout 内部，不改变 root route ownership。
- `Interaction = display-only`：本 feature 不承诺可点击 navigation target；pressable 扩展点留给下一条 feature。

### 关键决策

1. **挂载在 `packages/app/src/app/h/[serverId]/_layout.tsx`**
   - host layout 已拥有 `index`、`workspace/[workspaceId]/index`、`agent/[agentId]`、`sessions`、`open-project`、`settings` leaf routes。
   - `routeServerId` 可从 `useLocalSearchParams()` 获得；存在时已包 `HostRouteProvider`。
   - shell 作为 `HostRouteProvider` 内的直接子组件包住 `Stack`，不把 UI 组件放进 `src/app` 目录。

2. **状态栏作为 flex footer 参与布局**
   - 形状：
     ```tsx
     <HostStatusBarLayout serverId={routeServerId}>
       <Stack ... />
     </HostStatusBarLayout>
     ```
   - layout 内部是纵向容器：`content flex:1 minHeight:0` + `GlobalStatusBar` footer。
   - 不使用 absolute bottom overlay；这样 workspace screen 的 `flex:1/minHeight:0` 内容和 composer 会自然让出高度。

3. **状态栏拥有 host bottom safe area，并提供 bottom chrome context**
   - compact/mobile 上，footer 背景延伸到底部 safe area；状态栏内容行与 safe-area padding 分离。
   - host shell 提供 `HostBottomChromeProvider`（或等价 context），暴露状态栏可见时的 `bottomChromeHeight` / `bottomSafeAreaOwned`。
   - 直接贴底的 host leaf 消费者必须改用 shared helper 计算有效 bottom inset，至少覆盖 `AgentPanel` composer input area 和 host settings 底部 padding；不能继续在状态栏上方无条件叠 `insets.bottom`。
   - 键盘打开时，composer 的 keyboard shift 必须以“状态栏已占用底部 chrome”为前提校准：状态栏可选择被键盘覆盖或随内容上移，但 composer 与键盘之间不能多偏移一个 footer 高度。

4. **UI 组件落在 `packages/app/src/status-summary/`**
   - 与前置 app store 模块同域，新增 `global-status-bar.tsx` / `global-status-bar-layout.tsx`。
   - 组件只依赖 `useGlobalStatusBarView(serverId)` 和 platform/layout/focus hooks。
   - 样式使用 `StyleSheet.create((theme) => ...)`，不新增 `useUnistyles()`。

5. **第一版展示密度克制**
   - desktop：单行 horizontal chips，左侧 usage，右侧 activity；只用顶部分隔线，无浮动卡片、阴影或装饰背景。
   - compact：单行摘要，优先展示 today/lifetime/running/attention；长值截断，避免撑高或横向溢出。
   - `runningAgents` 可作为一个只读数量/短文本 signal 暴露，但不渲染可导航列表。

6. **focus mode 由 shell 决定隐藏**
   - `usePanelStore((state) => state.desktop.focusModeEnabled)` 已在 root/workspace chrome 使用。
   - shell 读取同一来源；focus mode 时返回 `null`，等价于 roadmap 的 `hidden/focus-mode`。

### 视觉 thesis / 内容计划 / 交互 thesis

- 视觉 thesis：状态栏应像工作台底部的细信息轨，低对比、稳定、可扫，不像一个新的 dashboard。
- 内容计划：左侧 usage 摘要，中间运行/需处理状态，右侧 freshness/error/offline 小状态；compact 收敛成一行优先级摘要。
- 交互 thesis：本 feature 只保留轻微 press/hover 扩展空间，不实现弹层；hover/pressed 状态不能改变外部几何尺寸，native/compact 不依赖 hover。

### Top 3 风险与缓解

1. **footer 挤压或遮挡 workspace composer / mobile safe area**
   - 缓解：使用 participating flex footer；由 shell 拥有 bottom safe area 并通过 bottom chrome context 让主要 leaf 扣减重复 inset；验收覆盖 workspace 页面、settings/sessions 页面、compact 键盘开合。
2. **误挂 root layout 变成 app-global 单例**
   - 缓解：挂载点只允许 host layout；反向核对 `packages/app/src/app/_layout.tsx` 不应出现 status bar 挂载。
3. **UI shell 偷做数据 fallback 或导航**
   - 缓解：组件只读 view model；grep 阻止 client/provider/agent list/timeline 调用；详情弹层和导航留给下一 feature。

### 非显然依赖与关键假设

- 依赖 `app-status-summary-store` 导出 `useGlobalStatusBarView(serverId)`，并已处理 capability、offline、loading、error、row formatting。
- 假设 host layout 是正确 route ownership 边界；不新增或重排 `Stack.Screen` names。
- 假设 workspace screen 的主容器已是 `flex:1/minHeight:0`，可被外层 footer 正常压缩。
- 假设 first version 可以在 focus mode 隐藏；用户已在 roadmap design 口头确认底部位置与 design 方向。
- Safe area 归属选择：状态栏可见时由 footer 拥有 bottom safe area；主要贴底 leaf 必须通过共享 helper 扣减自身 bottom inset。该约束来自现有 `AgentPanel` composer 已直接使用 `insets.bottom` 和 keyboard shift 的代码事实。
- 前置 `app-status-summary-store` 尚未在当前仓库落地；实现启动前必须确认 hook kind 与本设计对齐。

## 2. 名词与编排

### 2.1 名词层

#### 现状

- `packages/app/src/app/h/[serverId]/_layout.tsx` 当前返回 `Stack`，有 `routeServerId` 时包 `HostRouteProvider`；没有 host-specific chrome。
- `docs/expo-router.md` 要求 host layout 只注册直接 leaf routes，不能在 root layout 注册 host grandchildren。
- 前置 `app-status-summary-store` 设计导出 `useGlobalStatusBarView(serverId)`，view model 已把 unsupported/offline/loading/error/ready 分支集中。
- `docs/design.md` 要求 product UI 安静、复用 primitives、用 theme tokens；`<StatusBadge>` 可作为状态语义参照，但它只有 `success/error/muted` 三种 variant，不能直接承载状态栏四 tone 视觉。
- `docs/unistyles.md` 禁止新增 `useUnistyles()`；新样式应走 `StyleSheet.create((theme) => ...)`。
- `packages/app/src/panels/agent-panel.tsx` 的 active composer 同时使用 `useSafeAreaInsets()` 的 `insets.bottom` 和 `useKeyboardShiftStyle({ mode: "translate" })`；参与式 footer 插入后，若不扣减，会在 composer 与 footer 间产生重复 bottom inset，并可能在键盘打开时多偏移 footer 高度。

#### 变化

新增 UI-facing 类型与组件契约：

```ts
type GlobalStatusBarProps = {
  serverId: string;
};

type HostStatusBarLayoutProps = {
  serverId: string;
  children: React.ReactNode;
};
```

组件职责：

- `HostStatusBarLayout`：纵向布局容器，保证 route content `flex:1/minHeight:0`，底部渲染 `GlobalStatusBar`。
- `GlobalStatusBar`：读取 `useGlobalStatusBarView(serverId)`，按 `kind` 渲染 hidden/loading/offline/unsupported/error/ready。
- `HostBottomChromeProvider` / `useHostBottomChromeInset`（命名可实现期微调）：向 host leaf 暴露 status bar 可见时的底部 chrome 占用和 safe-area 归属，供 composer/settings 等贴底区域扣减重复 inset。
- `StatusSummaryChip` 或等价内部组件：固定高度、稳定宽度策略的摘要片段；使用状态栏自有轻量 chip，不直接复用 `<StatusBadge>`。

Tone 映射：

| tone      | foreground token                       | background/border strategy       | 用途              |
| --------- | -------------------------------------- | -------------------------------- | ----------------- |
| `default` | `foregroundMuted`                      | transparent 或 `surface2` 低对比 | 普通 usage / idle |
| `ok`      | `statusSuccess` 或 green palette token | 低 alpha / muted border          | running 正常      |
| `warning` | `statusWarning` 或 amber palette token | 低 alpha / muted border          | needs attention   |
| `danger`  | `statusDanger` 或 red palette token    | 低 alpha / muted border          | error             |

不硬编码 hex；实现期若 theme 暂无 alpha helper，用已有 theme palette/token 组合，不新增新 token。

Shell 从前置 hook 读取的 view model kind 固定为：

```ts
type StoreStatusBarKind =
  | "hidden" // reason: no-host
  | "offline"
  | "unsupported"
  | "loading"
  | "error"
  | "ready";
```

`focus-mode` 不来自 hook；由 `GlobalStatusBar` 在 hook 外读取 `panel-store.desktop.focusModeEnabled` 后叠加隐藏。`unsupported` 是 hook 的顶层 kind，本 feature 选择渲染为 `null`，不是 `hidden.reason`。

状态分支：

- `hidden/no-host`：host layout 理论上不传空 serverId；组件仍可返回 `null` 防御。
- `focus-mode`：shell 自己判断并返回 `null`。
- `unsupported`：默认隐藏或极低调显示升级提示二选一。本 feature 选择**隐藏**，避免旧 daemon 上出现不可操作 chrome；polish 阶段可再决定是否展示 "Update host"。
- `offline`：显示上次摘要的低调 offline signal（如 view model 有 previous summary）或一条 "Offline" muted chip。
- `loading`：显示固定高度 skeleton/inline spinner，不导致页面跳高。
- `error`：显示小型 muted/error 文案，保留 fixed height。
- `ready`：渲染 primary rows 和 activity counts。
- `provider usage`：v1 不渲染任何 Usage 入口；provider plan usage 入口留给 nav/polish feature，避免 display-only shell 出现不可操作 label。

### 2.2 编排层

```mermaid
flowchart TD
  A[/h/[serverId]/_layout matched] --> B[resolve startup route]
  B --> C{routeServerId exists}
  C -- no --> D[render Stack only]
  C -- yes --> E[HostRouteProvider]
  E --> F[HostStatusBarLayout]
  F --> G[content area flex:1 minHeight:0 renders Stack]
  F --> H[GlobalStatusBar footer]
  H --> I[useGlobalStatusBarView(serverId)]
  I --> J{view kind / focus mode}
  J --> K[null / quiet state / ready row]
```

#### 现状

- host layout 的 `Stack` 当前直接作为 `HostRouteProvider` children。
- root `AppContainer` 已有 desktop focus mode 对 sidebar 的隐藏逻辑，但 host layout 不读取 focus mode。
- workspace screen 自己有 workspace-specific `FloatingPanelPortalHost`，root app 也有 `FloatingPanelPortalHost`；status bar shell 不需要新 portal。
- root 已包 `SafeAreaProvider`，组件可用 `useSafeAreaInsets()`。

#### 变化

- 在 host layout 中把 `stack` 包为 `hostContent`：
  - 无 `routeServerId` 时保持现状返回 `stack`。
  - 有 `routeServerId` 时返回：
    ```tsx
    <HostRouteProvider serverId={routeServerId}>
      <HostStatusBarLayout serverId={routeServerId}>{stack}</HostStatusBarLayout>
    </HostRouteProvider>
    ```
- `HostStatusBarLayout`：
  - outer：`flex:1; minHeight:0; backgroundColor: surface0/surfaceWorkspace`。
  - content：`flex:1; minHeight:0`。
  - footer：由 `GlobalStatusBar` 自身决定是否渲染；隐藏时不占高度。
  - provider：包 `HostBottomChromeProvider`，让 leaf 可读取 status bar 可见高度与 bottom safe-area ownership。
- `GlobalStatusBar`：
  - 调 `useGlobalStatusBarView(serverId)`。
  - 调 `usePanelStore` 读取 focus mode；focus mode true 返回 `null`。
  - 调 `useSafeAreaInsets()`，footer 拥有 bottom safe area；内容行高度与 bottom safe-area padding 分离，测量/常量化状态栏 chrome 高度后写入 bottom chrome context。
  - ready 分支按 view model rows 渲染；未知/空 row 不渲染占位数字 0。
- bottom chrome consumers：
  - `AgentPanel` active composer input area 使用 shared helper，把 `{ paddingBottom: insets.bottom }` 改为有效 bottom inset；状态栏可见时不再在 composer 与 footer 之间重复叠 safe area。
  - host settings 等贴底 padding 使用同一 helper 或 context；实现期 audit `useSafeAreaInsets()` consumers，只改会在 `/h/[serverId]/*` 中与 status bar 相邻的底部 padding。
  - 键盘打开时，验证 composer shift 与 footer 高度不重复；若实现选择键盘打开时隐藏 footer，必须由 shell/context 明确表达并测试。

#### 流程级约束

- Route ownership：不新增 `Stack.Screen`，不把 host leaf screen 注册到 root layout。
- Layout：禁止 `position:"absolute"` / `bottom:0` 作为主布局策略；状态栏必须参与 flex 布局。
- Safe area：footer 背景必须覆盖 bottom inset；内容行高度和 safe area padding 分离，避免 iPhone home indicator 上文字贴边。
- Bottom inset ownership：状态栏可见时 footer 拥有 bottom safe area；贴底 leaf 不能再无条件把 `insets.bottom` 作为自身 bottom padding。共享 bottom chrome helper 是唯一允许的扣减入口，避免每个 leaf 手写分支。
- Text overflow：所有 row/chip 都 `minWidth:0`，长 label/value 使用 `numberOfLines={1}`；compact 下低优先级 row 可隐藏，不允许撑出屏幕。
- Loading/error height：loading/offline/error/unsupported 的可见分支和 ready 分支保持相近高度，避免切换时页面大跳动。
- Hover/native：本 feature 不隐藏关键操作在 hover 后；若实现 hover style，只能改变颜色/opacity，不能改变高度、padding 或 mount 导致布局跳动。
- Keyboard：不新增 portal/floating panel；但必须定义状态栏与 keyboard shift 的相对行为。v1 选择：键盘打开时 footer 仍属于 bottom chrome，但 composer 的 effective bottom inset 通过 shared helper 扣减，避免多偏移 footer 高度；若真机验证发现仍错位，允许实现把 footer 在键盘打开期间隐藏，并把该行为写入测试/QA 证据。
- Anchored overlays：composer autocomplete/command popover 等锚定浮层不得被 footer 裁切或测错；S4 手工验证覆盖一次。
- Provider usage：v1 不渲染 Usage 入口，不读取 `provider.usage.list`。

### 2.3 挂载点清单

- `packages/app/src/app/h/[serverId]/_layout.tsx`：host route layout 挂入 `HostStatusBarLayout`；删除此挂载后状态栏从所有 host pages 消失。
- `packages/app/src/status-summary/global-status-bar-layout.tsx`：新增 host footer layout wrapper。
- `packages/app/src/status-summary/global-status-bar.tsx`：新增 display-only 状态栏组件及内部 chip/row。
- `packages/app/src/status-summary/bottom-chrome-inset.tsx` 或等价文件：新增 bottom chrome context/helper，集中处理 footer 高度与 safe-area 归属。
- 贴底 host leaf 消费者（至少 `packages/app/src/panels/agent-panel.tsx`，必要时 `packages/app/src/screens/settings-screen.tsx`）：改用 bottom chrome helper，删除与状态栏冲突的重复 bottom safe-area padding。
- `packages/app/src/status-summary/global-status-bar*.test.tsx` 或等价目标测试：覆盖状态分支、focus hidden、layout contract。

### 2.4 推进策略

1. Shell layout 骨架：新增 `HostStatusBarLayout`，在 host layout 内包住 `Stack`，无 `routeServerId` 仍保留现有返回。
   退出信号：目标测试或 diff review 证明只改 host layout、不改 root route；wrapper content 是 `flex:1/minHeight:0` + footer。
2. Bottom chrome inset contract：新增 bottom chrome context/helper，把 footer height、bottom safe-area ownership 和主要 leaf 的 effective bottom inset 接起来。
   退出信号：`AgentPanel` composer 不再在状态栏可见时无条件叠 `insets.bottom`；settings 等相邻底部 padding 已 audit；单测或 diff review 能看到统一 helper 而非散落手写扣减。
3. Display-only 状态栏组件：实现 `GlobalStatusBar` 的 loading/offline/error/unsupported/ready 分支和 focus mode hidden。
   退出信号：组件测试覆盖每个 view kind；focus mode true 时不渲染 footer。
4. Ready row/chip 展示：把 `primaryRows` 和 agent counts 渲染成 desktop/compact 的单行摘要。
   退出信号：长 label/value、空 rows、缺 cost 字段不溢出、不显示伪造 0；desktop/compact 分支可由测试或 Story/screenshot 证据覆盖。
5. Safe area、keyboard 与 layout 验证：接入 `useSafeAreaInsets()`，确认 footer 背景覆盖底部 inset、leaf 不重复 inset、keyboard 开合不造成 composer 错位。
   退出信号：web/desktop + compact/mobile 手工或截图检查 workspace + settings/sessions 至少两类 host page；iOS home-indicator 机型或模拟器验证 composer 与状态栏之间无死白安全区带，键盘打开时 composer 不多偏移 footer 高度；锚定 autocomplete/command popover 不被 footer 裁切。
6. 范围守护与验证：运行目标 component tests、typecheck、lint、format check，并做 grep/diff review。
   退出信号：验证命令或环境阻塞记录齐全；grep 证明未调用 provider usage、daemon client、agent list/timeline 和未挂 root layout。

### 2.5 结构健康度与微重构

##### 评估

- `packages/app/src/app/h/[serverId]/_layout.tsx`：当前很小，承担 host route ownership。加一个 wrapper 挂载是职责内改动；不应把 UI 细节写进该文件。
- `packages/app/src/app/_layout.tsx`：root chrome 已复杂且无单一 host；本 feature 不触碰，避免 app-global 状态栏和 host 选择策略返工。
- `packages/app/src/status-summary/`：前置 feature 已计划承载 app status summary cache/view model；UI shell 与数据 hook 同域合理，但组件文件需与 query/push/view-model 分离。
- `workspace-screen.tsx`：已很大且只负责 workspace 工作面；不应把跨页面 status bar 塞进 workspace screen，否则 agent/sessions/settings 不可见。
- `panels/agent-panel.tsx`：现有 composer 贴底 safe-area/keyboard 逻辑会被状态栏影响；本 feature 只允许对 bottom inset 读取点做最小改动，不在该大文件里放状态栏 UI 或 summary 逻辑。
- `components/ui/`：状态栏不是可复用 primitive；内部 chip 若未来复用三处以上再提取。

##### 结论：不做微重构

理由：唯一 route 挂载文件很小，新 UI 能落在 `status-summary/` 独立文件；bottom chrome helper 可以作为新小模块隔离，不需要先拆 root layout、workspace screen 或 agent panel。实现时必须保持 host layout 只做 wrapper wiring，视觉和分支逻辑留在新组件文件，agent panel 只做 effective bottom inset 接入。

## 3. 验收契约

### 3.1 关键场景清单

- 正常：进入 `/h/{serverId}/workspace/{workspaceId}` → 页面底部出现状态栏，workspace 内容区域被压缩而非被覆盖。
- 正常：进入 `/h/{serverId}/agent/{agentId}`、`/h/{serverId}/sessions`、`/h/{serverId}/settings` → 同一 host status bar 仍可见。
- 正常：ready view model 含 lifetime/today/running/attention rows → 状态栏渲染可读摘要。
- 正常：summary 缺 cost 字段 → 不显示 cost 0，不留明显空洞。
- 边界：compact/mobile 有 bottom safe area → footer 背景延伸到底部，文字不贴 home indicator。
- 边界：compact/mobile workspace composer → composer 与状态栏之间没有重复 safe-area 死白带。
- 边界：compact/mobile 键盘打开/收起 → composer 不因 footer 高度产生额外偏移；若 v1 选择键盘打开隐藏 footer，该行为必须稳定且可观察。
- 边界：desktop focus mode enabled → 状态栏隐藏且不占 footer 高度。
- 边界：unsupported old daemon → 不调用 fallback，不显示误导性数据；第一版默认隐藏。
- 边界：offline/loading/error → footer 保持低高度、文案安静，不导致大幅 layout jump。
- 错误：超长 token 数或 agent title/label → 单行截断，不撑破 footer。
- 错误：composer autocomplete/command popover 打开 → 锚定浮层不被 footer 裁切或明显错位。
- 范围：diff 中不出现运行 session 弹层、navigation handler、provider usage fetch、daemon client 调用或 root layout 挂载。

### 3.2 明确不做的反向核对项

- diff 中不应在 `packages/app/src/app/_layout.tsx` 挂载 `GlobalStatusBar` / `HostStatusBarLayout`。
- diff 中不应新增 bottom sheet、popover、hover card、Portal 或 session detail modal。
- diff 中不应调用 `client.getStatusSummary()`、`provider.usage.list`、`listProviderUsage`、`fetchAgents`、timeline API 或旧 daemon RPC。
- diff 中不应新增 navigation press handler、`navigateToWorkspace` 调用或 agent detail route push。
- diff 中不应新增 `useUnistyles()`。
- diff 中不应使用 absolute/fixed bottom overlay 作为 status bar 主布局。
- diff 中不应在多个 leaf 里手写不同的 bottom safe-area 扣减公式；应通过 bottom chrome helper/context 集中。

### 3.3 Acceptance Coverage Matrix

| Scenario                                                  | Covered By Step | Evidence Type               | Command / Action                                                                            | Core?                       |
| --------------------------------------------------------- | --------------- | --------------------------- | ------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------- | ---------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| Host layout 内所有 host leaf pages 共用底部 footer        | S1/S4           | diff review / screenshot    | 检查 host layout + 手工打开 workspace/sessions/settings                                     | yes                         |
| Footer 参与布局不遮挡 composer                            | S1/S4           | screenshot / manual QA      | workspace 页面输入区域可见且不被状态栏盖住                                                  | yes                         |
| Bottom safe-area ownership avoids duplicate inset         | S2/S5           | screenshot / diff review    | compact workspace composer 与状态栏之间无死白安全区带；AgentPanel 使用 bottom chrome helper | yes                         |
| Keyboard open/close keeps composer aligned                | S2/S5           | manual QA / screenshot      | iOS home-indicator 机型或模拟器打开键盘，composer 不多偏移 footer 高度                      | yes                         |
| Anchored composer overlays remain positioned              | S5              | manual QA                   | 打开 autocomplete/command popover，不被 footer 裁切或明显错位                               | no                          |
| Ready/loading/offline/error/unsupported/focus hidden 状态 | S3/S4           | component test              | `npx vitest run packages/app/src/status-summary/global-status-bar.test.tsx --bail=1`        | yes                         |
| Compact safe area 和文本截断                              | S4/S5           | screenshot / component test | compact viewport 截图或 RN test 断言 `numberOfLines`/style                                  | yes                         |
| 不做 fallback/provider/nav/sheet/root mount               | S6              | grep / diff review          | `rg "provider\\.usage\\.list                                                                | listProviderUsage           | fetchAgents                                     | getStatusSummary | navigateToWorkspace | HostStatusBar" packages/app/src/app/\_layout.tsx packages/app/src/status-summary packages/app/src/app/h/[serverId]/\_layout.tsx` 并人工核对上下文 | yes |
| No `useUnistyles()` and no absolute overlay               | S6              | grep / diff review          | `rg "useUnistyles                                                                           | position:\\s\*[\"']absolute | bottom:\\s\*0" packages/app/src/status-summary` | yes              |

### 3.4 DoD Contract

- Design DoD：本设计、checklist、design-review 均落盘；roadmap item 关联 feature。
- Implementation DoD：host layout 挂载、bottom chrome context/helper、status bar 组件、状态分支、safe area、keyboard/focus hidden 都实现；不越界实现导航/弹层。
- Review DoD：code review 重点核对 route ownership、layout overlay、fallback 调用、Unistyles/hover/safe area。
- QA DoD：目标组件测试通过；至少手工或截图验证 workspace + 一个非 workspace host page；记录无法运行的环境阻塞。
- Acceptance DoD：用户可在 host 内页面底部看到稳定摘要；focus mode/unsupported/offline 等边界行为符合设计；items.yaml 在 acceptance 阶段回写 done。

### 3.5 必跑验证命令

| id      | command                                                                              | core                                                                                                                  | failure_handling                                                           |
| ------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------- |
| CMD-001 | `npx vitest run packages/app/src/status-summary/global-status-bar.test.tsx --bail=1` | true                                                                                                                  | 失败则回实现修状态分支或测试夹具；若文件名调整，用等价目标测试替代并记录。 |
| CMD-002 | `npm run typecheck`                                                                  | true                                                                                                                  | 若跨包声明 stale，先按 AGENTS 指令运行对应 build script，再复跑。          |
| CMD-003 | `npm run lint`                                                                       | true                                                                                                                  | 只接受与本 feature 无关的既有红灯并记录证据；否则修复。                    |
| CMD-004 | `npm run format:check`                                                               | true                                                                                                                  | 失败则运行 `npm run format` 后复查。                                       |
| CMD-005 | `rg "provider\\.usage\\.list                                                         | listProviderUsage                                                                                                     | fetchAgents                                                                | getStatusSummary                                                                          | navigateToWorkspace | useUnistyles" packages/app/src/status-summary packages/app/src/app/h/[serverId]/\_layout.tsx packages/app/src/app/\_layout.tsx` | true | 有命中必须人工分类；越界命中需移除或回 design。 |
| CMD-006 | `rg "paddingBottom: insets\\.bottom                                                  | \\{ paddingBottom: insets\\.bottom \\}" packages/app/src/panels packages/app/src/screens packages/app/src/components` | true                                                                       | 对 host leaf 中与状态栏相邻的命中逐条分类；AgentPanel composer 不得保留无条件重复 inset。 |

## 4. 架构与文档回写预判

- 若实现确认 participating footer + bottom chrome context 是状态栏长期模式，可在 acceptance 或 polish 阶段沉淀到 `docs/design.md` 或 `.codestable/compound/`。
- 若 safe area / composer / keyboard shift 出现新 gotcha，应回写 `docs/floating-panels.md`、`docs/expo-router.md` 或新增 bottom chrome 约束说明。
- 本 feature 不更新协议/data-model/provider 文档；如果实现需要改这些范围，必须回 design。

## 5. 清洁度规则

- 不留下 TODO/FIXME、注释掉代码、临时 console/debug 输出。
- 不新增硬编码颜色、负 margin、装饰性 gradient/shadow。
- 不新增 `useUnistyles()`；icon color 如需 theme-reactive，使用现有 `withUnistyles` 模式。
- 不把 status bar copy 写成营销说明；只用短状态词和数值标签。
- 不新增 UI 字符串解释“如何使用状态栏”；状态栏应自解释。
