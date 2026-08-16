---
status: active
created: 2026-08-16
depends_on: team-methodologies
work: ../work/epic-team-task-room.md
---

# Team 任务室与协作体验

## 起点

Agent Teams 与 Team Methodology 已提供 host-global Team、workspace-bound Mission、持久 Room、
Workstream/Assignment、结构化报告、Attention、recipient outbox 和 Agent Profile 来源快照。当前产品面仍有
三个断层：

1. Team Hub 只是一张名称列表，创建入口和 idle Team 详情不足以帮助用户理解或复用 Team；
2. 新建 Team 暴露 Role、Level、Skill 和 execution profile 的完整领域结构，用户无法判断模板已经替他决定了
   什么、还必须选择什么；
3. Mission Room 虽然已有持久消息与 mention 唤醒，但缺少回复入口、默认 Lead 路由、任务上下文和清晰的成员
   汇报约定，使用体验更像一块空白日志而不是协作中的任务室。

Hermes Studio 的 Crew / War Room 证明了“稳定房间、成员状态、任务和产出在同一工作面可见”是有效的表现层。
它的 Crew 仍是向多个独立 session 广播同一任务，activity feed 只存在于客户端，Mission 状态也不是可靠的
持久领域事实。本 Epic 只借鉴任务室的表现，不复制 Crew、广播派工、名称寻址或浏览器本地状态。

本 Epic 继承 `agent-teams` 与 `team-methodologies` 的全部已接受领域契约，不重建 Team runtime。

## 决策摘要

- **TTR-DEC-1 - Team 是一级入口：** Team Hub 继续使用稳定的 host-owned
  `/h/[serverId]/teams` 路由和主导航入口。`Settings > Team` 只提供次级管理入口，不拥有 Team 列表或
  active Mission 工作面。
- **TTR-DEC-2 - 一个 Mission 一个任务室：** UI 名称“任务室”精确映射现有 Mission Room。Team 不拥有
  跨 Mission 永久群聊；每次 Mission 有独立 Room，终态 Mission 只读回放。
- **TTR-DEC-3 - 对话是主工作面：** active Mission 默认进入聊天主栏。任务、成员、结果和 Attention 是
  同一 Mission snapshot 的检查器，不与聊天组成四个等权 tab，也不复制成第二套状态。
- **TTR-DEC-4 - 三层事件边界：** Mission snapshot 是结构化当前事实；Room message stream 是持久交流
  历史；recipient outbox 是内部唤醒、重试和确认状态机。三者保持独立，由 App 读模型组合。
- **TTR-DEC-5 - 聊天不改变业务事实：** Room 文本、reply 和 mention 都不能推进 Assignment、解决
  Attention、批准 review 或完成 Mission。Agent 仍必须调用结构化 Team tools 持久化这些事实。
- **TTR-DEC-6 - 确定性消息路由：** 人类显式 `@member`、`@team` 与回复 Agent 作者合并为收件人；没有
  收件人时默认通知 active Mission Lead。Agent 只有显式 mention 才产生收件人，不因普通更新或回复隐式通知。
  `@team` 排除发送它的 Agent，所有收件人按 roster 顺序稳定去重；Lead 不可用时消息仍保存但不伪造 delivery。
- **TTR-DEC-7 - Participant 边界：** V1 只允许通知当前 Mission Participants。尚未 provision 的 Team
  Member 不会因 mention 被秘密启动；UI 不把它显示为可 mention 对象，手写该 handle 时返回可操作错误，
  提示用户直接通知 Lead 重新规划。
- **TTR-DEC-8 - Agent 公开汇报：** Agent 在 Assignment 开始、实质进展、阻塞、交付和审查结论时向
  Room 发布简短、可读更新。final verifier 先发布终态验证结果并显式 mention Lead；Lead 读取该结果后
  发布最终 Mission 总结并 mention 该 verifier；这条消息复用 recipient outbox 唤醒 verifier，verifier 看到总结后才调用
  `assignment_report`。这使负责人总结在 Mission
  完成前已持久化，无需完成后再唤醒 Lead。结构化 `assignment_report`、Mission snapshot 和 report evidence 仍是权威事实。
- **TTR-DEC-9 - 增量实现：** 复用现有 Room store、Team RPC、snapshot replica、recipient outbox、
  settings selectors 和 Agent tools。V1 不增加通用事件总线、不 event-source Mission、不新建第二套通知引擎。
- **TTR-DEC-10 - 功能胶囊优先：** 新领域选择器、表单投影和 UI 放在 Team-owned 目录；`session.ts`、路由、
  sidebar、client 和 protocol 只保留必要的 source routing、注册和 façade 接线，遵守
  `docs/changes-by-me.md` 的 upstream 同步边界。
- **TTR-DEC-11 - 无 Team 兼容层：** Team 尚未公开发布，不为开发期的 `@everyone`、旧表单层级或旧
  Room UI 增加 migration、dual-write、legacy projection 或 fallback。共享 wire schema 仍遵守仓库的
  additive/pure-schema 规则；本设计优先复用现有 RPC，不以兼容为由保留两套产品行为。
- **TTR-DEC-12 - 暂不持久化系统活动流：** 当前 snapshot 没有足够信息重建严格的历史顺序，因此 UI
  不伪造“任务开始/审查完成”聊天行。若未来需要可回放的系统活动时间线，另行设计 append-only
  `MissionActivityEvent`，不在本 Epic 中搭车实现。

## 目标

1. 让用户始终能从 host 一级导航找到、创建、查看和管理 Team。
2. 把新建 Team 收敛成“选择团队模板、确认建议成员、为成员选择 Agent Profile、创建”的主路径。
3. 把 active Mission 做成以群聊为中心的任务室，同时清晰展示任务、成员、结果和需要用户处理的事项。
4. 让 human reply、mention 和默认 Lead 路由具有可恢复的持久投递语义。
5. 让 Agent 在 Room 中留下足够的进展与交付说明，同时保持结构化 Mission/Assignment 事实唯一。
6. 保持 Team feature capsule 可随时在 clean milestone 上同步 upstream。

## 非目标

- 不创建跨 Mission 的 Team channel、Team inbox 或永久群聊。
- 不把 Team Room 接入 generic Chat/Loop storage，也不把普通 Agent transcript 复制进 Room。
- 不把 Mission aggregate 改造成 event-sourced aggregate，不新增统一前端或服务端事件总线。
- 不用自然语言解析来推进 Workstream、Assignment、review、Attention 或 Mission 状态。
- 不重新设计 scheduler、质量门禁、workspace lease、Methodology 编译或 Agent Profile 数据模型。
- 不自动 provision 被 mention 但尚未参加 Mission 的 Member。
- 不提供 typing indicator、在线 read receipt、emoji reaction、文件上传或独立 thread pane。
- 不为了新布局重写上游 sidebar、workspace screen、AdaptiveModalSheet 或通用 Chat 组件。

## Shared language

本文档使用以下唯一映射。UI 文案不得再引入“Crew”“War Room”“协作会话”等同义词。

| UI 名称      | 领域名称                          | 定义                                                                                    |
| ------------ | --------------------------------- | --------------------------------------------------------------------------------------- |
| **团队**     | Team                              | host-global、可跨 workspace 复用的稳定成员组织。                                        |
| **任务**     | Mission                           | Team 在一个明确 workspace 中执行的一次顶层工作；不是 Agent session。                    |
| **任务室**   | Mission Room                      | 一个 Mission 的持久群聊和协作工作面；不是新的 domain entity。                           |
| **工作项**   | Workstream                        | Mission 计划中的交付、集成或验证边界。                                                  |
| **执行记录** | Assignment                        | 一个 Participant 对一个工作项的结构化执行契约。                                         |
| **成员**     | Member                            | Team 中的稳定席位。                                                                     |
| **参与成员** | Mission Participant               | 当前 Mission 中已有 Agent binding 的 Member。                                           |
| **团队模板** | Team preset                       | Methodology 提供的 Member slot、Role、Skill、Level 和 Lead 提案。                       |
| **团队能力** | Skill                             | 用于 Workstream 匹配的稳定标签；不是用户创建 Team 时必须逐项理解的开关。                |
| **运行配置** | Agent Profile / execution profile | Agent Profile 是可复用来源，Team 保存权威 execution snapshot；它不提供 Role 或 prompt。 |
| **协作方式** | Methodology review policy         | UI 显示“负责人把关”或“独立成员审查”，不显示 `Collaboration Rules` 枚举名。              |

## 产品信息架构

### Host-global Team Hub

`/h/[serverId]/teams` 继续是 `HostLevelTeamList` 的唯一 owner。sidebar 的 Team 入口、host index 的
capability 三态、remembered workspace restore 和 idle Team placement 继续遵守现有路由契约。

Hub 顶部始终提供“新建团队”，不再只在空列表时显示。每个 Team row 至少显示：

- Team 名称、团队模板和成员头像；
- 当前 Mission 的目标、状态和 workspace，或“暂无进行中的任务”；
- open Attention 数和下一主操作；
- “进入任务室”“开始任务”“查看历史”三者之一；
- 次级管理菜单，进入 Team 设置而不是替代 Team 工作面。

有 live workspace 时 Hub 提供进入已有 workspace 的路径；零 live workspace 时保留 Add/Open Project 的
显式流程与 Hub return target。workspace 只决定 Mission 执行与 idle Team 的显示位置，不拥有或过滤 Team。

### Team detail 的三种状态

| 状态             | 首屏                                                                            |
| ---------------- | ------------------------------------------------------------------------------- |
| idle Team        | Team 概览：模板、成员、最近 Mission、启动 Mission；不渲染空聊天室。             |
| active Mission   | 直接进入任务室：聊天主栏 + 任务室 header + inspector。                          |
| terminal Mission | 对应任务室只读回放；可查看消息、任务、结果和 Attention 历史，再启动新 Mission。 |

一个 Team 同时最多一个 active Mission 的既有约束不变。历史 Mission 选择只切换只读回放，不改变 Team
activeMissionId 或 workspace placement。

`TeamPanel` 是 idle / active / terminal 三态的唯一产品 surface owner。host Team route 与 workspace panel deck
只负责挂载同一个 Team-owned panel，不解释状态：active Mission 使用 `activeMissionId`；历史回放使用 panel 已有的
`selectedMissionId` / local selection；两者都不存在时才是 idle 概览。零 live workspace 的 host surface 与
workspace deck 内的 active/terminal surface 必须分别验收，不把状态判断搬进 host route 或 workspace screen。

### 新建 Team

主路径使用渐进披露：

1. 输入 Team 名称并选择“团队模板”；模板选项直接说明成员数量和协作方式。
2. 展示建议成员卡片：Role、Lead 标记和一句职责说明只读；用户为每位成员选择 Agent Profile。
3. 展示创建摘要并提交。模板已物化的 Skill、Level、archetype binding 和 Methodology ref 随请求提交。

Agent Profile 可以被多个 Member 复用。主路径要求每个成员选择 Agent Profile；“高级设置”允许没有合适
Profile 时使用 inline provider/model/mode/thinking 配置。高级设置才显示 Level、团队能力、手动运行配置和
完整 Methodology facts。编辑 Team 继续提供完整配置，但 active Mission 的冻结约束不变。

“团队能力”在创建摘要中显示为只读标签，并用一句短说明指出它用于自动分配工作项；不渲染成一列没有上下文
的 toggle。“协作方式”只使用“负责人把关”与“独立成员审查”，最终验证另列为“完成前验证”。

### Mission 任务室

宽屏布局由三块组成：

```text
任务目标 / 状态 / workspace / Attention
----------------------------------------------------------
聊天消息与回复（主栏）                  任务室检查器
                                        任务 | 成员 | 结果
----------------------------------------------------------
回复上下文 + composer + 目标提示
```

检查器是无嵌套卡片的紧凑工作面。desktop/Electron 固定在右侧；compact/native 使用现有
`AdaptiveModalSheet` 从同一 selector tree 展示。聊天始终占主面积，不把“任务 / 成员 / 结果”做成与聊天
等权的顶层页面。

任务室 header 显示 Mission objective、状态、workspace 和 Attention 数。状态文案来自结构化 snapshot，
不是消息扫描结果。成员头像可打开其 Agent history；没有 active participant 的 Member 只出现在 Team 概览和
计划候选中，不进入 mention autocomplete。

## 分层架构

```text
                  daemon Team feature capsule

  TeamMission aggregate                 MissionRoomStore
  Workstream / Assignment               ordered TeamRoomMessage
  report / review / Attention            replyToMessageId / mentions
             |                                      |
             | publishMission                       | onMessage
             v                                      v
  team.mission.snapshot                 team.mission.message.posted
             |                                      |
             +------------------+-------------------+
                                v
                  App MissionWorkroomViewModel
                  current facts + room timeline
                                |
             +------------------+-------------------+
             v                                      v
       task/member/result inspector             conversation UI

  Mission recovery.recipientAttentionOutbox
  pending / notified / acknowledged / canceled
             |
             +--> same-turn steer or safe wake checkpoint
                  （内部投递事实，不是聊天或业务状态）
```

### Snapshot 层

`TeamMission` 是 Participants、Workstreams、Assignments、reports、review/final gate 与 Attention 的唯一
业务事实源。每次合法领域写入先经过现有 helper 和 aggregate CAS，再通过 `publishMission()` 发完整
`team.mission.snapshot`。App replica 对一个 Mission 做 authoritative replace。

本 Epic 可以增加 Team-owned selector 和只读 view model，但不能在 UI 中维护第二份可编辑任务状态。Room
消息不能被 reducer 解释成 snapshot patch。

### Message 层

`MissionRoomStore` 继续按 Mission 保存有序 `TeamRoomMessage`。现有 post/subscribe/unsubscribe、cursor、
`replyToMessageId`、`mentionAgentIds` 和 `team.mission.message.posted` 保持主协议。App 继续先注册 live listener
再读取初始页，避免 page/event race；服务端 message id 和 idempotency fingerprint 继续负责重放去重。

V1 回复采用平铺引用：消息行显示父消息作者和正文摘要，点击回复在 composer 上方显示上下文。不会创建 thread
子房间或新的持久化集合。现有 `replyToMessageId` 必须在当前 Mission Room 中存在；跨 Room、未知或自相引用均
返回稳定错误。

旧消息加载复用现有 cursor RPC，不新增历史 RPC。现有 `afterCursor` 是向前读取的绝对边界，wire `hasMore` 表示
返回 cursor **之后**是否还有消息，不表示是否存在更旧历史，也不改变 Agent forward read/ack 语义。App timeline
分别保存 `liveCursor` 与 `oldestCursor`：初始 `oldestCursor = cursor - messages.length`，`hasOlder = oldestCursor > 0`；
向前加载时计算 `pageSize = min(limit, oldestCursor)` 与 `startCursor = oldestCursor - pageSize`，再以
`afterCursor: startCursor, limit: pageSize` 读取。成功 response 的 `cursor` 必须等于读取前的 `oldestCursor`；App
prepend 该页并把 `oldestCursor` 更新为 `startCursor`。历史页忽略 response `hasMore`，重试或竞态产生的重叠项按
cursor 和 message id 去重。现有 `RoomTimeline.hasMore` 及其“表示更旧历史”的反向注释必须删除，或改名为只表达
wire forward page 的字段；产品历史入口只读派生的 `hasOlder`。

同一个 subscribe/read RPC 的生命周期必须区分首次订阅与已订阅的历史读取：只有本次调用新建了 source
subscription 时，读取失败才回滚该订阅；历史页读取失败绝不能 unsubscribe 已存在的 live 流。初始装配继续先注册
live listener 再读页，历史读取期间同时到达的 live message 只推进 `liveCursor`，不得丢失或重复。

### Delivery 层

所有需要唤醒 Agent 的 human post 与 Agent directed message 继续写同一个 Mission
`recipientAttentionOutbox`。它拥有 pending/notified/acknowledged/canceled、attempt、nextEligibleAt、
binding successor 和 crash recovery；UI、Room store 或 generic Chat 不创建第二套 delivery state。

recipient resolution 先校验 reply target 与全部显式 token，再按下表一次性决定结果。任何已识别但非法的 target 都在
持久化前 fail closed；不存在“先发消息、后发现某个收件人无效”的半提交。

| 作者与输入                                 | 有效收件人                                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| human 的显式 `@member` / `@team`           | 当前 active Participants；`@team` 先展开全部 active Participants。                                                                                    |
| human 回复 Agent 消息                      | 先用历史 `authorAgentId` 找到该 Mission Participant 的 `memberId`，再绑定该 Member 当前 active Participant；binding replacement 后仍通知同一 Member。 |
| human 合并以上结果后为空，active Lead 存在 | 当前 Lead Participant。                                                                                                                               |
| human 合并以上结果后为空，Lead 不可用      | 空集合；消息仍持久化，`mentionAgentIds` 为空，UI 明示“消息已保存，但当前没有可通知的负责人”，并从 `lead_unavailable` Attention 进入 `replace_lead`。  |
| Agent 的显式 `@member` / `@team`           | 当前 active Participants，但最终集合必须删除发送 Agent 自己。                                                                                         |
| Agent 无显式 mention，或只回复另一 Agent   | 空集合；公开更新仍持久化，不创建 delivery，不默认通知 Lead。                                                                                          |

human 的显式 mention 与 reply author 做并集；回复 human 作者本身不增加 Agent 收件人。Agent reply 不隐式通知
reply author，Agent 间需要协调时必须显式 mention 或使用 `team_message`。最终集合删除发送 Agent 自己，按 Member id
去重，再以 active roster 顺序排序。`TeamRoomMessage.mentionAgentIds` 记录**最终有效 delivery 收件人**，包括 reply 与
默认 Lead 派生的 Agent，而不只记录正文中的字面 mention。Agent 对只包含自己的单成员 Mission 使用 `@team` 时，
结果为空且不创建自投 delivery。

`@team` 取代开发期 `@everyone`，parser 只把 `team` 当作广播并在 roster handle 查表前处理。handle 分配器与 Team /
Mission validator 必须把 `team` 和 `everyone` 都列为保留字；`everyone` 仅保留名称、不形成广播 alias。Team 尚未
上线，因此已持久化的冲突 handle 不做 migration，直接 fail closed 并要求重建开发期 Team。手写一个当前 roster 中
存在但未 provision 的 handle 返回 `mission_member_not_provisioned` 类稳定错误，不发送、不落消息、不创建
Participant。未知 token 保持普通文本：human 在无其他目标时走默认 Lead，Agent 则不产生收件人。

composer 为一次用户提交冻结 `{requestId, body, replyToMessageId}`；响应丢失后的重试复用同一 `requestId`，编辑或
取消该 pending intent 后才生成新 key。daemon 的 `requestFingerprint` 只覆盖稳定用户意图
`{missionId, actorId, body, replyToMessageId}`，不包含从可变 Mission 状态派生的收件人。

每次 post 在解析当前 Mission 前，必须在同一个 Team serialization 边界内按确定性 `roomMessageId` 检查冻结状态：

1. 若 recovery 已有该消息的 delivery intents，先校验 fingerprint，再从这些**已持久化 intents**投影最终
   `mentionAgentIds`；本次调用不得先运行 recipient resolver，也不得使用局部重新解析结果。
2. 若 recovery 没有对应 intent，再按 `roomMessageId` 查询 Room。若消息已存在，校验其 actor、body 与 reply target
   等稳定用户意图后直接返回原消息，不创建 delivery、不重新解析收件人。这个 Room message 是零收件人 post 的
   冻结记录；只允许给现有 RoomStore 增加窄的按 id 读取能力，不增加 store、wire 字段或持久化集合。
3. 只有 recovery 与 Room 都没有该 key 时，才按当前 Mission 解析收件人。非空结果以一次 recovery CAS 写入
   delivery intents，随后 Room post 的 `mentionAgentIds` 必须从 CAS 提交后的 persisted intents 重新投影，并断言
   与每个 recipient delivery 一一对应；空结果直接 append Room message，由该消息冻结空集合。

若 Room 中存在非空 `mentionAgentIds`，但 recovery 中没有对应 delivery intents，则视为持久化不变量损坏并
fail closed，不得补发到当前 Lead。新消息使用新 key 时才读取最新 Mission 状态。这样 Lead replacement 或
Participant re-binding 发生在 crash/retry 之间时，旧 post 仍使用首次持久化的收件人；响应丢失后的零收件人 post
也返回原消息，不会在 Lead 恢复后补出孤立 delivery。

持久化顺序继续使用现有可恢复形状：先在 Mission recovery 中写确定性的 delivery intent，再 append Room
message，标记 room cursor，最后尝试 steer/wake。任一步 crash 都由 reconciliation 重放，不重复消息或投递。
普通消息结果只表示 daemon 已持久化消息并已排队/尝试通知；`mentionAgentIds: []` 明确表示无人被通知，
`acknowledged` 也不等于人类意义上的已读。V1 不增加在线 read receipt。

### Physical source 隔离

当前 Room subscription 是 Session 级 `Set<missionId>`，live message 使用 session-wide `emit()`。同一 Session
包含多个 physical socket 时，一个 source 的订阅会泄漏给 sibling source。本 Epic 在任何 Room UI 扩展前修复：

- subscription 改为 `Map<physicalSource, Set<missionId>>`；
- subscribe/unsubscribe 必须携带当前 source，并通过 source-specific response path 返回；
- live `team.mission.message.posted` 只用 `onMessageToSource` 投递给实际订阅且具备完整 Team V1 capability 的 source；
- 不保留 Session 聚合 fallback，不改变 RoomStore 或 wire message shape；
- `MissionRoomStore.onMessage` 继续是全局广播，Mission/source 过滤只发生在 Session 边界，不把 transport ownership
  下沉到 persistence；
- physical socket close 在现有 capability/identity cleanup 路径同时删除该 source 的 Room map entry；全 Session
  cleanup 清空整张 map。resume 不继承旧 source subscription，App 通过现有 hook 重新订阅；
- source-scoped `subscribeMissionRoom` 必须返回“本次是否新插入 subscription”的结果；runtime 读取失败时只回滚
  本次新插入的 subscription。first-subscribe 判定、失败回滚和 close/full-session cleanup 全部由
  TTR-ITEM-1 拥有，后续历史 UI 只消费该不变量；
- 同 Session 两个 socket 订阅不同 Mission 的测试必须证明无串流，socket close/resume 不影响 sibling source。

### Agent tools 与汇报

`team_message` 继续是明确单播并触发 recipient outbox。`chat_post` 改为既可回复，也可发布 standalone Room
update；它复用同一 token parser，但使用上表的 Agent 分支，不继承 human 的 reply-author 或默认 Lead 规则。
human mention delivery 仍只在 caller 对其精确 `roomMessageId` 使用 `replyToMessageId` 时 acknowledged；standalone
update 不会误 ack 另一条通知。需要立即协调的 Agent 必须显式 `@member`、`@team` 或使用 `team_message`。

每个 Assignment 的提示词 section 固定以下公开更新节点：

- 开始：一句说明已接手的工作项和边界；
- 进展：只在完成一个可验证阶段、做出影响下游的决定或预计明显延期时发布；
- 阻塞：先提交结构化 blocked report，再在 Room 说明 blocker、所需决定和受影响工作项；
- 交付：在结构化 completed report 前后发布 artifact、tests、decision 与 handoff 的简短摘要；
- review/verification：发布 verdict 和需要用户或 Lead 关注的具体问题；
- Lead：计划接受、replan 和 Attention 处理时发布面向全体的摘要；
- final verifier：发布终态验证结果时显式 mention Lead，等待 Lead 的最终 Mission 总结在 Room 可见后，
  才调用最终 `assignment_report`；
- Lead：收到 final verifier 的终态结果后读取 Room，发布面向用户的最终总结并 mention 该 verifier，以现有
  recipient outbox 唤醒它提交 report。Mission 完成后不再唤醒
  Lead 补发消息。

final verifier 发出结果后若尚未看到 Lead 总结，当前 turn 在不调用 `assignment_report` 的情况下结束。
现有 report recovery 下次唤醒时先 `chat_read`：已有 verifier 结果但没有 Lead 总结时继续不 report；两者都
可见时才 report。verifier 结果未持久化时，recovery 使用 Assignment 派生的稳定 idempotency key 只补发一次并
mention 当前 Lead。Lead 无 active Participant 时不降级跳过；由现有 `lead_unavailable` / `replace_lead` 路径恢复后再完成
总结和 report。verifier outcome 与 Lead summary 分别使用 Assignment 派生的固定 idempotency key 和可验证正文前缀；
最终验证 `assignment_report` 在 application service 内读取现有 Room message 与 verifier 的持久 chat cursor；缺少任一条、
作者/mention 不符、顺序颠倒，或 cursor 尚未覆盖 Lead summary 时 fail closed。若 verifier 同时是 Lead，它顺序发布两条不同消息、
再次 `chat_read` 看到 summary 后才 report，不要求 self mention；report recovery 发现已有
outcome 但没有 summary 时由该同一 Participant 自行补 summary，不等待不存在的另一条 Lead reply。证据审计按相同的
`missionId + agentId + Assignment idempotency key` 派生精确 message id，并校验正文前缀；普通双边聊天不能冒充收口证据。

recipient delivery 的 `:ack` message 禁止解析出任何收件人；Agent 即使违反 prompt 在 ack 中 mention 他人，application
service 也拒绝该 post，不允许 ack → delivery → ack 的通知循环。收口握手不强制额外的独立 ack 消息：Lead 最终总结就是对
verifier outcome 的确认，verifier 在成功 `chat_read` 后提交的最终 report 就是对 Lead 总结的确认；若 Agent 另发简短 ack，
证据可以记录其 message id，但缺少该冗余消息不能阻止 Mission 完成或使真实证据失败。

禁止把每次 tool call、token 流或完整 Agent transcript 镜像到 Room。成员没有新信息时不发心跳。审计继续以
Assignment report、accepted turn fact 和 workspace ownership evidence 为准。

## App 组合读模型

新增 Team-owned `MissionWorkroomViewModel`（最终文件名可遵循现有 selector 命名），只接收：

- `TeamV2` 与选中的 `TeamMission` snapshot；
- `RoomTimeline`；
- Session 已有的 Agent lifecycle/permission 投影；
- Methodology descriptor 与 Agent Profile display metadata，仅用于展示。

输出至少包含：header、conversation directory、work item rows、member rows、result/review rows、open Attention
summary、primary action 和 read-only 状态。它不发 RPC、不持久化、不推断领域转换。`TeamPanel` 只负责选择
idle/active/terminal shell，`MissionWorkroomView` 负责组合聊天与 inspector。

现有 `team-settings-view.ts` selector 先迁移为可被 settings 和 inspector 共同消费的纯投影；不复制 plan、成员或
Attention 计算。Team settings 保留 profile 编辑、Methodology 升级、成员高级配置和 lifecycle 操作，任务室检查器
只读展示 Mission facts 与已经存在的 controller action。

## Upstream 同步边界

| 层                                   | 归属                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol/src/team/`        | 现有 Team wire schema；本 Epic 优先零新 RPC，只做必要的纯 schema/测试调整。                                                            |
| `packages/server/src/server/team/`   | recipient resolution、Room/history application 逻辑、Agent prompt/reporting 契约。                                                     |
| `packages/app/src/teams/`            | Hub/创建/任务室纯状态、selector、form projection、timeline 合并。                                                                      |
| `packages/app/src/components/teams/` | Team-owned Hub、创建表单、任务室与 inspector 组件。                                                                                    |
| 命名的 Team bridge                   | `team-route-resolution.ts` 与 `team-panel-registration.tsx` 只拥有 Team placement / panel 注册；作为 fork-owned capsule 扩展单独复核。 |
| upstream-owned 热文件                | `session.ts` source routing、route/sidebar/panel 注册、client façade；只接受窄接线。                                                   |

每个子项的 review 必须分列 feature-owned 与 upstream-owned 文件。不得把 recipient 规则写进 `session.ts`，
不得把 Mission selector 写进 workspace screen，也不得为了共用一个小组件把 Team 类型引入通用 Chat。

## 失败场景

| 场景                                                             | 必需结果                                                                      |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 同一 Session 的 socket A 订阅 Mission A，socket B 订阅 Mission B | A 只收到 A，B 只收到 B；任一关闭不影响另一条订阅。                            |
| human 发送普通消息且无 mention/reply Agent                       | 一条 Room message + 一条 Lead delivery；crash replay 不重复。                 |
| human 无目标且 Lead 没有 active Participant                      | 消息保存、零 delivery、UI 明示未通知并引导处理 `lead_unavailable`。           |
| human 回复 active Agent                                          | 通知该作者；若另有显式 mention，稳定去重后同时通知。                          |
| human 回复已 re-bind 的 Agent 旧消息                             | 由旧 `authorAgentId` 找到 Member，再通知该 Member 的当前 active Participant。 |
| human 使用 `@team`                                               | 通知当前全部 active Participants；不启动 roster 中尚未 provision 的 Member。  |
| Agent 使用 `@team`                                               | 通知除发送者外的 active Participants；不创建自投 delivery。                   |
| Member handle 与 `team` 冲突                                     | 分配与 validation fail closed；`@team` 始终先按广播 token 解析。              |
| human 手写未 provision Member handle                             | 返回可操作错误，不写消息或 delivery；UI 建议直接发给 Lead 协调。              |
| Lead 正在运行且 provider 支持 steering                           | 同一 turn 收到通知，先在 Room 简短确认，再继续原 Assignment。                 |
| recipient busy 且不能 steering                                   | delivery 保持 pending，安全 checkpoint 后唤醒；不抢占或重放已接受工作。       |
| reply target 不在当前 Room                                       | post 被拒绝；无孤立 reply、消息或 delivery。                                  |
| Room 初始页加载期间有 live message                               | listener 保留并按 cursor 合并；消息不丢失、不重复。                           |
| 用户向前加载历史时有 live message                                | 历史 prepend，live append；两个 cursor 独立推进。                             |
| 已订阅 source 的一次历史页读取失败                               | 显示可重试错误，但不注销 live subscription；后续 live message 继续到达。      |
| 初始最新页被 limit 截断                                          | 由 `oldestCursor > 0` 显示历史入口，不误用 wire `hasMore`。                   |
| human post 响应丢失后重试                                        | composer 复用同一 request id，只产生一条消息和一组 delivery。                 |
| 零收件人消息落库、响应丢失后 Lead 被替换                         | 重试先返回原零收件人消息，不解析新 Lead、不写新 delivery。                    |
| outbox 已写、Room 未写时 Lead/Participant 发生变化               | replay 使用已持久化收件人，不重算 fingerprint，不产生孤立 intent。            |
| Team idle                                                        | 显示 Team 概览和 Start Mission，不显示空 composer。                           |
| Mission terminal                                                 | Room 与 inspector 可回放且只读；不得向终态 Mission post 或改状态。            |
| catalog 加载失败                                                 | Team Hub 和已有 Team 详情仍可用；新建/升级显示 Retry，不清空已打开表单。      |
| 创建中 Agent Profile 被编辑                                      | 提交使用 daemon 物化时的权威 Profile snapshot；表单明确显示最终选择。         |
| Agent 发完成文字但不提交 report                                  | Room 可见，但 Assignment 不完成，现有 needs_report 恢复继续生效。             |
| Agent 提交 report 但 Room 更新失败                               | 结构化事实保持成功；Room 更新可重试，不回滚 report 或伪造第二次执行。         |
| Agent standalone update 与待确认 human mention 并存              | standalone 不 ack；只有精确 reply 对应 message 才确认该 delivery。            |

## 验证策略

1. **Protocol / Session：** 同 Session mixed physical sockets、Room subscription source 隔离、reply target、
   `@team` 展开、默认 Lead、recipient 去重和 idempotency/crash replay。
2. **Domain / application：** Room prose 不改变 Mission、未 provision mention fail-closed、Agent report 与公开
   update 彼此独立、outbox binding replacement/restart reconciliation 无回退。
3. **App state：** Hub/idle/active/terminal 三态、创建渐进披露、reply composer、历史 prepend、snapshot 与
   timeline 乱序合并、catalog/replica 独立失败。
4. **真实 UI：** browser 与 Electron 覆盖创建 Team、启动 Mission、human 普通消息默认 Lead、reply、`@team`、
   任务室 inspector、终态回放；compact browser 加截图与重叠检查。
5. **Native / provider：** iOS 与 Android 各运行 Team Hub、创建表单和任务室核心路径；真实 provider 证明 Lead
   和 Member 在 Room 留下开始/进展/阻塞或交付更新，同时 Mission 只由结构化工具收敛。

不得用 JSDOM/mock 代替真实浏览器、Electron 或 native 证据。不得重跑全仓测试；每个子项运行 owning tests、
build owning stack、全仓 typecheck/lint/format，并由最终子项汇总平台矩阵。

## Proposed work items

### TTR-ITEM-1 · 固化三层事件边界并隔离 physical Room subscription

**依赖：** 无。

把 Session 的 Mission Room subscription 改为 physical-source scoped，补 mixed-socket 定向测试；由本项完整实现
first-subscribe 判定、读取失败的条件回滚与 source/session cleanup。冻结 Snapshot / Message / Delivery 三层
contract、recipient resolution 表和 App 组合读模型接口。证明不需要新 RoomStore、事件总线或 WebSocket RPC，并在
`docs/architecture.md` 与 `docs/data-model.md` 只更新已改变的约束。

**验收：** 同 Session 两 socket 不串消息；source close/unsubscribe/resume 不影响 sibling；现有 close 与 full-session
cleanup 都释放 map；首次订阅读取失败只回滚本次插入，已订阅 source 的历史读取失败不退订；Team RPC capability
与 source identity fail-closed；RoomStore 全局 `onMessage` 订阅接口保持不变；边界测试阻止 Team
domain/application import `session.ts` 或 generic Chat。

### TTR-ITEM-2 · 把 Team Hub 升级为 host-global 工作入口

**依赖：** TTR-ITEM-1。

扩展现有 Hub row、始终可见的创建操作和 Team detail 三态。idle Team 显示概览与 Mission history，active Team
进入任务室，terminal Mission 只读回放；Settings 只保留次级管理入口。保持 remembered workspace、零 workspace、
capability unknown/absent/present 与 replica/catalog failure 的现有路由契约。

**验收：** 有/无 Team、有/无 live workspace、remembered selection、replica failed、catalog failed、idle/active/
terminal Team 的真实组件与 browser 路由证据；host route 和 workspace deck 只挂载同一个 `TeamPanel`，terminal
selection 不改 active placement；`HostLevelTeamList` 仍只有一个 owner。

### TTR-ITEM-3 · 简化 Team 创建与协作方式文案

**依赖：** TTR-ITEM-1。

在现有 form model 上实现“名称与模板 → 建议成员与 Agent Profile → 确认”的渐进披露。主路径隐藏 Skill/Level/
inline model 细节，高级设置保留完整能力；模板继续物化权威字段。将 `Collaboration Rules` 替换为“协作方式”，
把 review policy 显示为“负责人把关”或“独立成员审查”，团队能力解释为自动分配依据。

**验收：** preset selection、Profile required/inline advanced、表单打开后 catalog 断线不丢输入、重复 Profile、
stale Profile/Methodology CAS、compact/native 布局和完整 create payload 定点测试；不修改 Team wire shape。

### TTR-ITEM-4 · 建立 MissionWorkroom 主布局

**依赖：** TTR-ITEM-2。

新增 Team-owned workroom view model 和 UI shell，组合现有 `TeamMission` replica、Room subscription 与 Agent
lifecycle。desktop/Electron 渲染聊天主栏 + 任务室 inspector；compact/native 用同一 selector tree 打开 sheet。
从 settings selectors 提取共享纯投影，不复制领域计算。

**验收：** objective/status/workspace/Attention header、空/加载/失败、active/read-only terminal、成员 Agent 跳转、
inspector responsive layout；分别在零 live workspace 的 host surface 与 workspace deck 验证同一 selector/view，
canvas/screenshot 检查无空白、遮挡、嵌套卡片或文字溢出。

### TTR-ITEM-5 · 固化 Room 发帖幂等性与 recipient routing

**依赖：** TTR-ITEM-1。

在 Team application 层实现本文的完整判定表：canonical `@team` 与保留 handle、human reply 的 historical
agentId → Member → current binding、默认 active Lead、Lead unavailable、Agent 作者排除与 Agent 不隐式路由。
所有有效收件人复用 recipient outbox。把 Agent `chat_post` 扩展为 standalone / reply / explicit mention，保持
`team_message` 明确单播，并保留“精确 reply 才 ack human delivery”的现有语义。App post gateway 为一次提交持有稳定
request id；daemon fingerprint 只绑定用户意图。post 必须先查 persisted delivery intents 与 Room message，再决定
是否运行 resolver；非空结果从 CAS 提交后的 intents 投影 Room `mentionAgentIds`，空结果由已落库 Room message 冻结。

**验收：** human 默认 Lead、Lead unavailable、reply 原作者及 re-binding、explicit mention、human/Agent `@team`、
Agent self exclusion、inactive Member、保留 handle、unknown reply、稳定 request id、response lost retry、outbox→Room
crash、Lead replacement、busy steer、idle wake、binding successor、终态拒绝和最终 `mentionAgentIds` 均有定点与
daemon E2E；必须交叉覆盖“零收件人落库 → 响应丢失 → replace Lead → 同 key 重试”仍返回原消息且零 delivery，
以及“outbox 已写 → Room 未写 → binding 变化 → 重放”在 post 前逐项断言 `mentionAgentIds` 等于 persisted intent
recipient 投影。同一用户意图只产生一条消息和一组 delivery。

### TTR-ITEM-6 · 闭合回复界面与 Room 历史

**依赖：** TTR-ITEM-4、TTR-ITEM-5。

让 App 透传现有 `replyToMessageId`，实现回复摘要、取消和目标提示。若历史 Agent 对应 Member 已无 active
Participant，composer 明示回复目标不可直达；无其他显式目标时按已冻结 routing contract 转交 active Lead，并在结果
中显示实际 notified recipient。复用现有 cursor RPC 向前加载历史，在 App timeline 分离 `liveCursor` /
`oldestCursor`，不把 wire `hasMore` 当作旧历史标记，并删除或改正现有反向注释。本项不修改 server subscription
生命周期，只消费 TTR-ITEM-1 已冻结的“历史读取失败不退订”不变量；RoomStore 与 wire shape 不变。

**验收：** unknown/cross-Room/self reply、回复 human/Agent、已离开成员转交 Lead 的可见提示、初始截断、按
`pageSize = min(limit, oldestCursor)` 连续向前分页、重叠页、history/live race、历史读取失败后 live 继续到达、
retry 与 terminal read-only 均有 App state、component 和 daemon E2E 证据；server rollback 行为只引用
TTR-ITEM-1 的 owning test，不在本项重复实现。

### TTR-ITEM-7 · 让 Agent 在任务室报告协作进展

**依赖：** TTR-ITEM-5。

把开始、实质进展、阻塞、交付、review/verification、Lead plan/replan 摘要，以及 final verifier 结果 → Lead 总结 → final
`assignment_report` 的收口顺序注入
现有 Team/Methodology prompt sections 和 tool descriptions。Room update 与 `assignment_report` 明确分工；recipient notification 继续要求 Agent 先
`chat_read`、简短确认，再继续当前 Assignment。运行时收口指令位于方法论 section 之后：当前持久 Assignment 是本 turn 的完整范围，
Agent 不得另起 agent/review 编排；除等待 Lead 总结的 final verification 外，turn 结束前必须恰好调用一次
`assignment_report`，不得只留下 prose 或 shell 输出。不得镜像 transcript 或每个 tool call。
报告可能先于 provider turn 终态落盘；`running + report` 是合法中间态，quality-gate planner 必须继续复用同一 Assignment，
不得在 turn 结算前 supersede 并创建 replacement review。

**验收：** prompt/tool contract 测试、漏 Room update 的真实失败用例、至少一条并行 Mission 和一条显式依赖 Mission；
prompt contract 必须证明长 review methodology section 之后仍保留单 Assignment 收口和必报规则；
调度测试必须覆盖 review report 已落盘而 accepted turn 尚未结算的窗口，并证明零 replacement churn；
两条真实证据都必须包含 mention Lead 的 final verifier 结果、之后 mention 该 verifier 的 Lead 最终总结，
并证明该总结早于 `mission.completedAt`；verifier timeline 必须证明成功 `chat_read` 的输出包含该 Lead summary message id，
且更高 seq 才出现该最终验证 Assignment 的成功 `assignment_report`；allowlisted manifest 持久化派生 closeout audit，包含
两条 message id/body digest、delivery 身份、存在时的 ack 身份、summary/completion 时间和 read/report seq，供 reviewer 复核；
若 verifier binding 在 summary 可见后更换，审计必须继续检查后续 binding 的 timeline，不能因旧 binding 只读未 report 而
提前失败；verifier 同时是 Lead 的路径改为两条无 self mention 的固定身份消息；
定点 crash/recovery 测试必须覆盖 verifier 结果已发、Lead 总结未发与两者都已发两种恢复状态，前者不得调用
`assignment_report`，后者不得重复发 Room update；Agent turn settlement listener 只把 durable fact / recipient eligibility
异步排入 Team reconciliation，不得同步等待可能回读同一 turn-state write 的 reconcile；测试必须覆盖该 callback 立即返回和
daemon restart 后从持久 report-recovery outbox 恢复且不重复启动 provider turn。每个成员有合理的开始/交付或阻塞消息，Assignment/Mission
状态只由结构化工具推进。真实 provider 启动的 code-deep 索引位于 `.codegraph`，与 `.git` 一样属于 workspace
基础设施元数据；默认 workspace audit policy 必须排除该前缀，且定点测试证明业务路径的 ownership 校验没有放宽。

### TTR-ITEM-8 · 把任务、成员、结果和 Attention 收敛到 inspector

**依赖：** TTR-ITEM-4。

复用 plan/member/review/final/Attention selectors 构建三个 inspector view。工作项显示 owner、依赖、状态和 blocker；
成员显示 Role、当前 Assignment、Agent lifecycle 和需要输入；结果显示 report artifact/test、review verdict、final
verification 与 waiver evidence。已有 controller action 可从 Attention 行进入，编辑仍留在 settings。

**验收：** delivery/review/verification、direct/dependency blocker、awaiting reviewer/capabilities、waiver、terminal
evidence 和 inactive Member 均有投影测试；聊天消息内容变化不会改变 inspector facts。

### TTR-ITEM-9 · 完成跨平台与真实协作验收

**依赖：** TTR-ITEM-2、TTR-ITEM-3、TTR-ITEM-5、TTR-ITEM-6、TTR-ITEM-7、TTR-ITEM-8。

闭合 browser、真实 Electron、compact、iOS、Android、daemon restart/mixed socket 和真实 provider 矩阵；更新
`docs/glossary.md`、`docs/architecture.md`、`docs/data-model.md`、`docs/expo-router.md` 与
`docs/changes-by-me.md` 的 owner 段落，删除被新契约取代的旧 Team UI 描述。最终验收确认没有跨 Mission chat、
统一事件总线、第二套 delivery engine 或 upstream 热文件中的 Team 领域规则。

**验收：** 两种 Team 模板、至少三个 Agent Profile、两个 workspace 的同 Team 后续 Mission、默认 Lead/reply/
`@team`、Room history、Attention、final verification、终态回放和真实平台证据全部通过；独立 reviewer 给出
0 blocking / 0 important 后才进入 owner final acceptance。

## 依赖顺序

```text
TTR-ITEM-1
  ├─ TTR-ITEM-2 ── TTR-ITEM-4 ─┬─ TTR-ITEM-6
  │                              └─ TTR-ITEM-8
  ├─ TTR-ITEM-3
  └─ TTR-ITEM-5 ─┬─ TTR-ITEM-6
                  └─ TTR-ITEM-7

TTR-ITEM-2/3/5/6/7/8 ── TTR-ITEM-9
```

TTR-ITEM-2、TTR-ITEM-3 与 TTR-ITEM-5 可在 TTR-ITEM-1 后并行。TTR-ITEM-6、TTR-ITEM-7 与
TTR-ITEM-8 在各自依赖满足后可并行；TTR-ITEM-6 与 TTR-ITEM-8 都消费 `MissionWorkroomViewModel` 时，
由先启动者拥有公共 selector 骨架，避免双写。

## 整体验收标准

- Team Hub 是 host-global Team 的一级入口和唯一列表 owner；Settings 只做次级管理。
- idle Team 不显示空 Room；active Mission 默认进入任务室；terminal Mission 只读回放。
- 创建主路径只要求理解模板、建议成员和 Agent Profile；Skill/Level/inline execution 留在高级设置。
- UI 使用“协作方式：负责人把关 / 独立成员审查”，不再显示 `Collaboration Rules`。
- UI “任务室”只映射 Mission Room，不创建 Team-global chat 或新 domain entity。
- `TeamPanel` 是 idle/active/terminal 的唯一状态 owner；host route 与 workspace deck 只挂载，不复制判断。
- Mission snapshot、Room message、recipient delivery 三层保持独立，App 只在读模型组合。
- 同 Session mixed physical sockets 的 Room subscription 不串流，不发生 capability 或消息泄漏。
- 普通 human post 默认通知 active Lead；Lead unavailable 时消息保存但不伪造通知。
- human reply 按历史 Agent 找到 Member 的当前 binding；Agent reply 不隐式通知作者。
- human `@team` 展开 active Participants；Agent `@team` 必须排除发送者，不产生自投 delivery。
- 未 provision Member 不因 mention 启动；inactive handle fail-closed 并提示找 Lead 协调。
- `team` 是广播保留 handle，`@everyone` 不形成 alias；冲突的开发期 Team 不迁移而是 fail closed。
- composer retry 使用稳定 request id；fingerprint 不包含可变 recipient，crash replay 不重复消息或投递。
- 所有通知复用 recipient outbox 的幂等、重试、ack、binding successor 与 crash recovery。
- 回复和历史加载使用现有 Room store/cursor；App 以 `oldestCursor` 判断更旧历史，读取失败不注销 live 流。
- Agent 在 Room 发布开始、实质进展、阻塞、交付和审查摘要，但不镜像 transcript 或工具流水。
- Room prose 永远不能完成 Assignment、批准 gate、解决 Attention 或完成 Mission。
- inspector 只读 Mission facts；聊天内容变化不会改变其任务、成员或结果状态。
- desktop、compact、Electron、iOS 与 Android 均有真实执行证据；不以 JSDOM/mock 冒充平台证据。
- Team-owned 逻辑留在 feature capsule；upstream-owned 文件只有 source routing、route/sidebar 注册和 façade 接线。
- 无 Team migration、dual-write、legacy UI、`@everyone` fallback、统一 event bus 或第二套通知引擎。

## 遗留风险

- V1 没有持久 `MissionActivityEvent`，因此系统状态变化不会按历史时间穿插进 Room。当前任务室通过 Agent 公开
  更新与 snapshot inspector 提供上下文；若真实使用证明仍需系统活动历史，再独立设计 append-only projection。
- V1 没有在线 read receipt。`acknowledged` 表示 Agent 按 Team 协议读取/回复了 delivery，不代表人类意义上的
  已读状态；UI 不应使用 Slack 的“已读”措辞。
- 真实 provider 是否稳定遵守公开汇报约定必须用多次 Mission 证据验证。Prompt 测试只能证明指令存在，不能证明
  模型行为。
- native 与 Electron 的风险主要来自同一 UI 原语的新组合。TTR-ITEM-9 必须补真实平台证据，不能再次把它留到
  final acceptance 才由 owner 豁免。
