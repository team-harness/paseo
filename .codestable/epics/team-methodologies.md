---
status: active
created: 2026-08-11
depends_on: agent-teams
work: ../work/epic-team-methodologies.md
---

# Team Methodology 方法体系

## 决策摘要

本设计在现有 Agent Teams 运行时之上增加版本化的 Team Methodology。Methodology 提供可复用的
名册提案、规划策略、审查策略、Playbook 和提示词资产，但不拥有 Mission 状态，也不执行工作。

- **TM-DEC-1 - 运行时所有权：** Paseo 继续拥有 Team profile、Mission、Workstream、
  Assignment、room、工作区租约、provider session、持久投递和恢复。
- **TM-DEC-2 - 必需的 Methodology：** 每个 Team profile 都有一个精确的默认 Methodology。若用户
  未选择其他 Methodology，新 profile 使用 `paseo/standard@1`。
- **TM-DEC-3 - Mission 选择：** V1 在 Mission 启动时显示 Team Methodology，但不允许按 Mission
  覆盖。Methodology 更新仅适用于后续 Mission。
- **TM-DEC-4 - 冻结编译：** Mission 启动时，在创建 room 或供应 Lead 前编译并持久化完整的
  Methodology snapshot。
- **TM-DEC-5 - 固定策略 schema：** bundle 仅包含数据。运行时策略使用版本化的封闭 schema。
  bundle 不能提供可执行的策略编译器或生命周期 hook。
- **TM-DEC-6 - 规格 Playbook：** 需求、设计、任务和文档工作流在 V1 中仅提供建议。缺少规格产物
  不会阻止 Mission 完成。
- **TM-DEC-7 - 审查门禁：** `portable/software-delivery@1` 要求每个可写的交付或集成 Workstream
  接受独立审查。缺少审查者只会阻塞受影响的质量门禁，不会阻塞计划创建或无关的交付工作。
- **TM-DEC-8 - 操作者审查豁免：** 受信任的控制器可以显式豁免一次无法执行的审查，并记录原因。
  Agent 工具不提供此操作，最终证据中仍可看到该操作。V1 不声称在本地受信任用户边界内提供
  加密级真人在场保证。
- **TM-DEC-9 - 最终验证：** 每个 Mission 都必须经过最终验证，且不可豁免。
- **TM-DEC-10 - 分发分离：** Codex 和 Claude exporter 使用同一个规范 bundle。导出的提示词不会
  声称目标无法强制执行的 Paseo 运行时保证。
- **TM-DEC-11 - 全局 Team 归属：** Methodology binding、preset、Member archetype 和 Skill 映射
  属于 host-global Team profile。workspace 属于 Mission，而不是 Team 或 Methodology。Team wire 上的
  `creationWorkspaceId` 只记录创建上下文，不能进入 Methodology 编译或限制 Team 复用。
- **TM-DEC-12 - Agent Profile 来源：** Team Member 可以引用一个 host-local Agent Profile 作为
  execution profile 的来源，但 Team 必须同时保存完整、权威的 `executionProfile` 快照。Mission 只读
  Team/Mission 中的快照；Profile 变化只能通过显式刷新进入后续 Team revision。
- **TM-DEC-13 - 单一首发契约：** Agent Teams 与 Team Methodology 尚未公开发布。V1 直接采用最终
  持久化、RPC 和 UI shape，不实现旧 Team schema、迁移、双写、legacy projection、字段补齐或降级路径。
  capability 仅表示当前 physical host 是否支持完整功能，不承担字段级兼容。

## 目标

1. 复用 `portable-agent-team` 的 role、工作流、模板和分发逻辑，同时不创建第二套 Team 运行时。
2. 让 Team 一次选择稳定的工作方法，并在不同 workspace 的后续 Mission 中一致应用。
3. 在 Paseo 掌握权威事实的范围内，将选定的 Methodology 规则转为 daemon 强制执行的策略。
4. 将需要模型判断的指导保留为有名称、可检查的 Playbook。
5. 在 bundle 升级、移除或 daemon 重启后，保留精确的重放和审计行为。

## 非目标

- V1 不从 Methodology bundle 加载可执行代码。
- V1 不组合多个 bundle，也不解析 bundle 依赖图。
- V1 不在活跃 Mission 或重新规划期间更改 Methodology。
- V1 不从 `.agent-team/specs` 或生命周期 JSONL 恢复运行时状态。
- V1 不让独立的 Codex 或 Claude 导出等同于 Paseo 的调度与恢复。
- V1 不让 Methodology bundle、binding 或 preset 拥有 workspace、repository path、scope lease 或
  workspace 状态，也不提供按 Mission 覆盖 workspace-independent Team Methodology 的能力。
- V1 不让 Agent Profile 成为 Mission 的实时依赖，也不自动把 Agent Profile 的 notes、显示 metadata、
  passthrough 字段或未来 prompt 字段注入 Methodology 或 Agent prompt。

## 领域术语

| 术语                         | 定义                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Team methodology**         | 一组版本化的名册提案、Mission 硬策略、Playbook 和提示词资产。                                        |
| **Methodology bundle**       | 用于分发一个 Team Methodology 的规范内容寻址产物。                                                   |
| **Team preset**              | Member slot、Lead 选择、Skill、Level 和 archetype binding 的提案；它不会选择 workspace 或创建 Team。 |
| **Member archetype**         | 可复用的 Role 提案，包含建议的 Skill、Level、Playbook 和 Member 数量限制。                           |
| **Playbook**                 | 面向某阶段或受众的建议性指令。可移植的 `SKILL.md` 会成为 Playbook。                                  |
| **Methodology binding**      | host-global Team profile 采用的精确 bundle ref 和显式映射。                                          |
| **Methodology snapshot**     | 冻结到一个 Mission 中的完整编译策略和提示词 section。                                                |
| **Execution profile source** | Team Member 的可选来源记录；指向 host-local Agent Profile，并证明当前快照由哪个 resolver 物化。      |
| **Review waiver**            | 仅追加的操作者决定；它满足一个无法执行的审查门禁，但不声称获得独立批准。                             |

Paseo **Skill** 仍是 Team 拥有并用于匹配的能力。Playbook 不能作为 Skill 引用。可移植的 role 会成为
Member archetype；Team profile 仍拥有实际的 Role、Level、Skill、execution profile 和 Lead 指定。
可移植的 `cap` 会成为 archetype 的 Member 数量限制，绝不会成为 Level 或运行时并行度。

## 所有权与模块结构

```text
portable-agent-team
  创作源、reference bundle、Codex/Claude exporter、安全安装器
                              |
                              v
                 规范 Methodology bundle
                              |
                              v
Paseo TeamMethodologyModule: list + describe + compileMission
                              |
                              v
host-local Agent Profile catalog -> TeamAgentProfileMaterializer
                              |
                              v
host-global Team profile: roster + execution snapshot + Methodology binding
                              |
                              v
workspace-bound Mission: snapshot + DAG + Assignment + room + 租约 + 恢复
```

`TeamMethodologyModule` 是运行时接缝。它通过三个操作封装源布局、规范化、digest 检查、binding
验证、硬策略编译、提示词渲染和编译产物缓存。Codex 和 Claude exporter 是独立模块，因为它们的
调用方、副作用和错误模式不同。

编译器在进程内运行。bundle 查找可由本地实现替换：生产环境先使用嵌入式 bundle，测试使用内存
source。未来的 registry 可以添加远程 source，而无需更改运行时接口。

## Methodology bundle V1 规范

### 规范结构

```ts
type Sha256 = `sha256:${string}`;

interface ExactMethodologyRef {
  bundleId: string;
  version: string;
  digest: Sha256;
}

interface MethodologyBundleV1 {
  schemaVersion: 1;
  identity: {
    bundleId: string;
    version: string;
    name: string;
    description: string;
    license: string;
    homepage: string | null;
  };
  skills: MethodologySkillDefinition[];
  archetypes: MemberArchetypeDefinition[];
  playbooks: PlaybookDefinition[];
  presets: TeamPresetDefinition[];
  policy: MethodologyMissionPolicyV1;
  promptAssets: MethodologyPromptAsset[];
}
```

存储的产物省略自身 digest。ref digest 是规范 UTF-8 JSON 的 SHA-256；使用 LF 行尾、排序后的对象
key，并按稳定 id 规范化 source array。提示词资产顺序由显式 `order` 表示；文件系统枚举绝不会
影响 digest。

`bundleId` 使用 owner/name namespace，例如 `paseo/standard` 或
`portable/software-delivery`。V1 `version` 是正十进制字符串，因此 `paseo/standard@1` 表示精确
版本 `1`，不是 semver 范围或可变的 major alias。任何内容变更都会创建新版本。持久化状态绝不
包含 `latest`、`stable`、版本范围、branch 名或可变 URL。

### Skill 与 archetype

```ts
interface MethodologySkillDefinition {
  skillId: string;
  name: string;
  description: string | null;
}

interface MemberArchetypeDefinition {
  archetypeId: string;
  name: string;
  description: string;
  suggestedSkillIds: string[];
  suggestedLevel: 1 | 2 | 3 | 4 | 5;
  playbookIds: string[];
  maxMembers: number | null;
}

interface TeamPresetDefinition {
  presetId: string;
  name: string;
  description: string;
  skillIds: string[];
  slots: Array<{
    slotId: string;
    archetypeId: string;
    suggestedRole: string;
    suggestedLevel: 1 | 2 | 3 | 4 | 5;
    suggestedSkillIds: string[];
  }>;
  leadSlotId: string;
}
```

preset 返回提案。用户可以重命名 Role、更改 Level 和 Skill、选择 execution profile、添加 Member，
或移除可选 slot。最终的 Team 事实仍具有权威性。每个实体化的 Member 和 Skill 都存储显式 bundle
binding；匹配绝不比较显示名称或描述。`maxMembers` 限制绑定到该 archetype 的 Member；未绑定的
自定义 Member 不占用此限额。preset 不包含 workspace 字段；从 workspace 页面发起创建，只会给 Team
的 `creationWorkspaceId` 提供创建上下文，不会改变 preset 或 binding。

`portable-agent-team` 的 agent 文本不会原样写入 Team Member 的 `role`，也不会变成新的 provider
subagent 类型。导入器把可复用身份说明转换为 archetype，把工作方式转换为 Playbook/prompt asset，把
可强制约束转换为封闭 policy。Team 创建时，preset slot 只提议实际 Member；用户确认后的 roster 才是
成员事实。每个实际 Member 可绑定一个 archetype，也可为 null；Methodology 中没有对应实际 Member 的
archetype 不会生成“幽灵成员”，一个 archetype 也可以按 `maxMembers` 绑定多个实际 Member。

Mission 编译按实际 roster、显式 archetype binding、Member audience 和 Mission phase 选择 prompt
asset。它们成为该 Member 启动或 Assignment prompt 的冻结 Methodology section。实际 Agent 仍由 Member
的 Paseo execution profile 创建；“全栈工程师”等内置选择只是 preset/archetype 提案，不是绕过 roster
另行启动的内置 subagent。

### Agent Profile 来源与快照

Agent Profile 是 host-local 的可复用启动配置。它可以帮助用户给 Team Member 选择 provider、model、
mode、thinking option 和 feature values，但不拥有 Team Role、Level、Skill、archetype、Playbook 或
Methodology policy。Team Member 使用以下单一 V1 结构：

```ts
interface ExecutionProfileSource {
  kind: "agent_profile";
  profileId: string;
  resolverVersion: 1;
  appliedDigest: Sha256;
}

interface TeamMemberProfile {
  memberId: string;
  role: string;
  level: 1 | 2 | 3 | 4 | 5;
  skillIds: string[];
  executionProfile: TeamExecutionProfile;
  executionProfileSource?: ExecutionProfileSource;
  mentionHandle: string;
}
```

`executionProfileSource` 的可选性是产品语义，不是兼容措施。缺失 source 表示用户直接维护 inline
execution profile。带 source 的 Member 仍必须保存完整 `executionProfile`；source 只提供来源、同步状态
和显式刷新入口，不能替代快照。

daemon 通过单一 `TeamAgentProfileMaterializer` 读取一次权威 Agent Profile catalog，并按
`resolverVersion: 1` 产生：

```ts
interface MaterializedTeamExecutionProfile {
  source: ExecutionProfileSource;
  executionProfile: TeamExecutionProfile;
}
```

V1 resolver 将 Agent Profile 的 `provider`、`model`、`modeId`、`thinkingOptionId` 和
`featureValues` 规范化到 `TeamExecutionProfile`：缺失的可空 scalar 变为 `null`，缺失的 feature map 变为
空对象。`appliedDigest` 是该规范快照的 canonical JSON SHA-256；对象 key 排序，array 保持原序。它不包含
Profile 的 `name`、`icon`、`color`、`notes`、未知 passthrough 字段或任何 prompt 字段。

创建、绑定或刷新时，daemon 必须按 `profileId` 找到恰好一个 Profile，完成规范化与 Team execution
profile 校验，然后在同一个 Team CAS 中写入 source 和快照。缺失返回
`team_agent_profile_not_found`；重复 id 返回 `team_agent_profile_ambiguous`；无法物化为合法
`TeamExecutionProfile` 返回 `team_agent_profile_invalid`。不得按名称、数组位置或 provider 猜测。

Agent Profile 编辑不会自动改 Team。Team 设置比较当前 catalog 的 V1 materialization 与
`source.appliedDigest`，显示 `current`、`update_available`、`missing` 或 `ambiguous`。用户显式刷新后创建新
Team revision；手动编辑 Member 的 provider/model/mode/thinking/features 会移除 source，转为 inline。
Profile 删除或暂时不可读时，Team 继续使用最后一次快照；UI 显示 source 缺失，但 Mission 仍可启动。
仅修改名称、图标、颜色、notes 或 passthrough 字段不会改变 digest，状态仍为 `current`。

materializer 从同一份 daemon config snapshot 产生 source 与 execution snapshot，之后才尝试 Team CAS；
两者永远成对提交。Agent Profile catalog 与 Team store 不建立跨文件事务。若 Profile 在这段时间再次变化，
已提交 Team 仍准确记录它实际采用的 digest，下一次 inspect 显示 `update_available`。

Mission start 把 `executionProfile` 与当时的 source 一并复制到冻结名册；source 只用于审计，Agent 创建
只读快照。recovery、replan、Participant replacement 和 capability refresh 都不读取 Agent Profile
catalog。未来 Agent Profile 新增运行时字段时，必须升级 resolver/schema，并由用户显式刷新。未来
Profile prompt 字段也不会自动进入 Team：Member 方法说明由 Methodology archetype/Playbook/prompt
asset 提供，Agent 身份、workspace 和工具由 Paseo 运行时 section 提供。

| 输入来源                                        | V1 prompt 所有权                                                |
| ----------------------------------------------- | --------------------------------------------------------------- |
| Agent Profile                                   | 不提供 Team prompt；只物化运行配置。                            |
| Methodology archetype / Playbook / prompt asset | 生成按 Member audience 与 Mission phase 冻结的方法说明。        |
| Paseo Team runtime                              | 生成 Member/Mission 身份、workspace、工具、当前状态与下一动作。 |
| Assignment Contract                             | 追加本次 Assignment 的不可变目标、scope、依赖和验收事实。       |

### Playbook 与提示词资产

```ts
interface PlaybookDefinition {
  playbookId: string;
  name: string;
  description: string;
  audience: Array<"lead" | "delivery" | "review" | "verification">;
  phase: "startup" | "planning" | "assignment" | "review" | "completion";
  promptAssetIds: string[];
}

interface MethodologyPromptAsset {
  assetId: string;
  mediaType: "text/markdown";
  order: number;
  content: string;
}
```

提示词资产可以解释硬规则，但不能定义硬规则。它们不能包含运行时标识符、workspace id、工作区路径、provider
命令、生成的时间戳或 Mission 状态。渲染仅接受固定的 placeholder 词汇；未知 placeholder 会导致
编译失败。

### Mission 策略

```ts
interface MethodologyMissionPolicyV1 {
  planning: {
    specificationPlaybook: "advisory";
  };
  review: {
    writableWorkstreams: "independent_required" | "lead_discretion";
    unavailable: "attention";
    unknownCapabilities: "nonwaivable_attention";
    operatorWaiver: "allowed_with_reason" | "forbidden";
  };
  verification: {
    required: true;
    operatorWaiver: "forbidden";
  };
}

interface CompiledMissionPolicyV1 {
  review: {
    writableWorkstreams: "independent_required" | "lead_discretion";
    independentMeans: "different_from_subject_owner";
    unavailable: "review_gate_reviewer_unavailable_attention";
    unknownCapabilities: "review_gate_capability_unknown_attention";
    operatorWaiver: "allowed_with_reason" | "forbidden";
  };
  verification: {
    required: true;
    mutableScope: "read_only";
    reviewerSelection: "prefer_independent_record_exception";
    operatorWaiver: "forbidden";
  };
}
```

V1 不公开通用策略 map 或自定义 contribution kind。新的硬语义需要更改 schema 和 daemon capability。
未知字段会导致 bundle 验证失败。建议性规划行为编译为命名的提示词 section，而不是
`CompiledMissionPolicyV1`。

## 运行时接口

```ts
interface TeamMethodologyModule {
  list(): Promise<MethodologyDescriptor[]>;
  describe(ref: ExactMethodologyRef): Promise<MethodologyDescriptor>;
  compileMission(input: CompileMissionMethodologyInput): Promise<MissionMethodologySnapshot>;
}

interface MethodologyDescriptor {
  ref: ExactMethodologyRef;
  name: string;
  description: string;
  license: string;
  presets: TeamPresetDefinition[];
  archetypes: MemberArchetypeDefinition[];
  skills: MethodologySkillDefinition[];
  policySummary: CompiledMissionPolicyV1;
  playbooks: Array<Pick<PlaybookDefinition, "playbookId" | "name" | "description" | "audience">>;
}

interface CompileMissionMethodologyInput {
  binding: TeamMethodologyBinding;
  teamRevision: number;
  roster: MethodologyRosterProjection;
  mission: {
    objective: string;
    constraints: string[];
    acceptanceCriteria: string[];
  };
}

interface MethodologyRosterProjection {
  rosterSnapshotRevision: number;
  leadMemberId: string;
  members: Array<{
    memberId: string;
    role: string;
    level: number;
    skillIds: string[];
    capabilityFacts:
      | { kind: "known"; capabilityIds: string[] }
      | { kind: "unknown"; providerId: string; reason: "provider_declaration_unavailable" };
  }>;
}
```

`list` 和 `describe` 返回安全的 catalog 数据和 profile 提案。它们不返回原始安装路径、provider model
map 或未渲染的私有 metadata。`compileMission` 仅从 `binding.ref` 解析一个 ref；调用方不能提交两个
不一致的 ref。启动服务从权威 snapshot 派生名册 projection，并规范化每个 id array。它排除时间戳、
运行时 Agent id、实时 Participant 状态、可变的 `providerAvailable` 配置位，以及 Team 创建上下文、
Mission `workspaceId`、workspace path 和 `executionProfileSource`。Agent Profile provenance 与
Methodology 选择无关；编译只读取名册中已经冻结的结构 capability 事实。workspace 独立性是接口约束：相同的 binding、Team
revision、结构化名册和 Mission 语义输入在 workspace A 与 B 中产生相同的 Methodology snapshot。
编译是确定性的：相同的 binding、Team revision、结构化名册 projection、Mission 输入和编译器版本
会生成逐字节相同的策略与提示词输出。

该接口返回结果或稳定的 domain error。它不更改 Team、Mission、room、Agent 或文件系统，也不解析
workspace。Paseo 在最终 Agent prompt 装配阶段从已持久化 Mission 或 start intent 生成独立的运行时
section，其中包含当前 Mission id、`Mission.workspaceId`、workspace path、工具和状态。该 section
不属于 Methodology snapshot 或 `promptDigest`，也不是隐藏的编译输入。

### 错误码

| Code                                 | 含义                                                            |
| ------------------------------------ | --------------------------------------------------------------- |
| `methodology_not_found`              | Mission 启动前无法取得精确的本地产物。                          |
| `methodology_digest_mismatch`        | 产物内容与 Team 的精确 ref 不匹配。                             |
| `methodology_schema_unsupported`     | daemon 无法解析 bundle schema。                                 |
| `methodology_invalid`                | ID、reference、placeholder 或策略无效。                         |
| `methodology_binding_invalid`        | Team Member 或 Skill 不满足其显式 binding。                     |
| `methodology_capability_unknown`     | 无法通过 provider declaration 确认 Lead 所需的启动 capability。 |
| `methodology_capability_unsatisfied` | 已知结构事实证明 Lead 无法满足所需的启动 capability。           |
| `methodology_prompt_budget_exceeded` | 渲染后的 section 超出配置预算。                                 |

所有错误都采用 fail-closed，并包含 JSON path 或 binding id。编译绝不返回不完整 snapshot，也绝不回退到
之前硬编码的 Team 提示词。

## Team profile 集成

每个 host-global Team profile 都存储一个必需的 binding：

```ts
interface TeamMethodologyBinding {
  ref: ExactMethodologyRef;
  presetId: string | null;
  memberArchetypeBindings: Array<{
    memberId: string;
    archetypeId: string | null;
  }>;
  skillBindings: Array<{
    teamSkillId: string;
    methodologySkillId: string | null;
  }>;
}
```

`paseo/standard@1` 内嵌在系统中，并在用户未选择 Methodology 时成为默认值。它编码当前的中性行为：运行时
不变量和最终验证仍为必需，可写 Workstream 的审查由 Lead 决定。`portable/software-delivery@1` 要求对
可写 Workstream 进行独立审查，并添加规格、协调、审查和文档 Playbook。

App 和 CLI 将默认产品选择显式解析为精确的内嵌 `paseo/standard@1` ref 并随创建请求发送。daemon
只接受完整 binding，因此所有 Team 从第一次写入起都使用同一个编译器路径；不存在缺失 binding 的
运行时补齐。

Team profile 固定一个精确 Methodology。V1 不公开 Mission 覆盖。仅当 Team 没有非终态 Mission 时，
Team 设置才可规划升级。升级会比较当前 binding、下一个 descriptor 和当前 Team 事实，然后要求用户
处理已移除的 archetype、Skill 或必需策略，之后才提交一个 Team revision。

binding、preset id、Member archetype 和 Skill 映射都随全局 Team profile 持久化，可由同一 Team 在
不同 workspace 的后续 Mission 中复用。Team 的 `creationWorkspaceId` 不参与 binding 校验、Team 列表、
Methodology catalog、升级资格、Mission workspace 选择或编译 digest。创建上下文 workspace 被归档后，
Team 与 Methodology 设置仍存在并可从 host-global 入口访问。

实现此设计期间，该功能仍处于预发布状态。开发数据直接重置；运行时不读取缺失 binding、旧 Team
shape 或没有 `executionProfile` 的 Member。

独立审查要求特意不纳入启动时 capability 拒绝条件。即使 Team 没有合格的独立审查者，也可以启动
Mission、规划可写工作并执行交付。只有在所有结构事实均已知且无人合格时，已完成的可写 Workstream
才进入 `review_gate_reviewer_unavailable`；未知事实走不可豁免的 capability 解析路径。
这样可保留实用的单人和小型 Team 工作流，又不会把独立审查变成无法验证的提示词约定。

## 协议与持久化 V1 契约

Agent Teams V2 与 Team Methodology V1 作为同一个首发产品契约落地。wire command、domain aggregate
与持久化各自采用适合其职责的唯一 V1 shape，并共享同一组必需业务事实；开发期旧 Team 文件直接重置。实现不得增加 Team migration、dual write、legacy
adapter、旧 projection、缺失字段 normalizer、旧 RPC fallback 或 Team 专属 `COMPAT(...)` shim。

| Aggregate 或 request   | V1 必需结构                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `TeamV2`               | `creationWorkspaceId`、完整 roster、每个 Member 的 `executionProfile`、可选产品语义的 `executionProfileSource`，以及完整 `methodologyBinding`。 |
| Team profile 创建/更新 | 发送精确 Methodology ref/binding；每个 Member 的 execution selection 明确为 inline snapshot 或 `agent_profile` source。                         |
| Mission start          | `workspaceId`、`expectedTeamRevision` 与 `expectedMethodologyRef` 全部必需。                                                                    |
| `TeamMission`          | 完整 Methodology snapshot、review/final gate、Attention、waiver 和 capability replan request。                                                  |
| Workstream             | 权威 `MissionReviewGate`；不保留可空 reviewer projection。验证 Workstream 另有权威 `finalVerificationGate`。                                    |
| Attention              | 必需 `scope` 和与 kind 对应的 typed details；resolution 使用完整可辨识 union。                                                                  |
| Assignment Contract    | 必需 Methodology、subject gate 和 final gate fingerprint；历史 Assignment 保留原 revision。                                                     |
| 名册 Member capability | 必需结构化 `capabilityFacts`；不保留 `providerAvailable`/capability/tool 的兼容双投影。                                                         |
| 内部 Mission 恢复      | capability replan request 复用现有 recipient outbox；恢复状态不进入 Session snapshot。                                                          |

Team profile 命令以明确的 execution selection 接收 Member 输入：

```ts
type TeamExecutionProfileSelection =
  | { kind: "inline"; executionProfile: TeamExecutionProfile }
  | { kind: "agent_profile"; profileId: string };

interface RefreshTeamMemberExecutionProfileInput {
  idempotencyKey: string;
  teamId: string;
  memberId: string;
  expectedTeamRevision: number;
}

type RefreshTeamMemberExecutionProfileResult =
  | { disposition: "unchanged"; teamRevision: number; appliedDigest: Sha256 }
  | { disposition: "updated"; team: TeamV2 };
```

`agent_profile` selection 只能由 daemon materializer 产生持久化 source 与 snapshot。inline selection
直接写快照且没有 source。编辑现有 Member 的 execution profile 使用同一 union；选择 inline 会明确
detach。刷新操作只允许带已有 `executionProfileSource` 的 Member，重新解析同一 `profileId`，并在
expected-revision Team CAS 中同时更新快照、digest 和 Team revision。materialized digest 未变化时返回
`unchanged` 且逐字节零写入；inline Member 返回 `team_agent_profile_source_required`。

所有 Methodology、review gate、Attention scope、capability fact 与 final gate 字段从首版起即为 wire
必需字段。`MissionCapabilityReplanRequest` 的 Session projection 只包含 request id、排序后的源
Attention id、名册 snapshot revision、创建时间和消费时间；内部幂等 fingerprint、recipient delivery id
和原始恢复状态只出现在 daemon inspect/audit。

feature flag 只做完整功能的可用性判断。App/CLI 使用 physical host 的 `teamMissions`、
`globalTeamProfiles` 和 `teamMethodologies` 结果决定 loading、unsupported 或 supported；首发版本要求三者
共同存在才开放完整 Team mutation 和 snapshot。缺少任一 flag 时显示升级 host，不运行 standard-only、
workspace-bound 或字段省略的降级 Team。Session 按 physical source 授权完整 V1 RPC；不得聚合同 client
label 的其他 socket 或其他 host 的 capability，也不为不同 source 生成字段不同的 Team snapshot。

Team 代码不维护 old/new App、CLI 或 daemon 的字段矩阵。版本测试只验证：不支持完整 V1 的连接被整体
拒绝且得到可读 unsupported 状态；支持 V1 的连接收发同一个 schema；同 Session 混合 physical source
不会泄漏 projection 或 mutation 权限。

新 RPC 仍位于现有 namespace 下：

```text
team.methodology.list.request / response
team.methodology.get.request / response
team.profile.create.request / response
team.profile.update.request / response
team.profile.member.execution.refresh.request / response
team.mission.start.request / response
team.mission.capability.refresh.request / response
team.mission.attention.resolve.request / response
```

catalog 读取由 daemon 负责。app 不自行读取 bundle 文件或计算 digest。

## Mission 启动与恢复

wire 与 application service 使用同一个字段完整的 V1 command：

```ts
interface StartMissionInput {
  idempotencyKey: string;
  teamId: string;
  workspaceId: string;
  expectedTeamRevision: number;
  expectedMethodologyRef: ExactMethodologyRef;
  objective: string;
  constraints: string[];
  acceptanceCriteria: string[];
}
```

Mission 启动服从全局 Team 设计的 workspace lifecycle fence 与 Team permit 顺序：

1. 规范化并验证请求中必需的 `workspaceId`，不读取 Team 的 `creationWorkspaceId` 作为默认值。
2. 先取得请求 `workspaceId` 的 workspace lifecycle fence，再取得该 Team 的单一 permit。涉及多个
   workspace 的生命周期操作先按规范 workspace id 排序取得全部 fence。任何路径都不得持有 Team
   permit 等待 workspace fence。
3. 在两层许可内重读权威 Team 和 workspace，再用完整请求计算 idempotency fingerprint。fingerprint
   包含请求 `workspaceId`、Team
   revision、精确 Methodology ref 和规范化 Mission 语义输入。
4. 先查询持久 start receipt、Mission 和 start intent，再校验新 mutation。相同 key 搭配不同 fingerprint
   返回 idempotency conflict；相同 fingerprint 返回既有终态 Mission，或只从既有 intent 恢复未完成
   启动。精确 replay 不重新应用当前 Team revision、当前 Methodology ref 或 active-Mission 栅栏。只有
   没有 receipt/intent 的新请求才验证 workspace 存在且未归档、Team revision 与 ref 未陈旧、Team
   可用且该 Team 没有非终态 Mission。workspace 必须为 active 且没有 archive intent。同 key 指向
   workspace B 与 C 必须返回 idempotency conflict。
5. 解析精确的本地 bundle 并验证 digest，创建名册和 provider capability snapshot，再派生不含
   workspace 与时间戳的结构化 projection 来编译 Methodology。
6. 在持久启动 intent 中原子记录请求 `workspaceId`、完整名册 snapshot、完整 Methodology
   snapshot、预分配 identity 和规范 fingerprint。
7. 只根据该 intent 创建 Mission aggregate 和 room，并把 intent 的 `workspaceId` 写入
   `Mission.workspaceId`。
8. 在 `Mission.workspaceId` 中供应 Lead，并由持久化 Mission 运行时 section 与冻结 Methodology
   section 组装启动提示词。

第 6 步成功后，恢复只读取 intent 中的 workspace 和编译输出。它绝不回落到 Team 创建 workspace，
也不解析、下载或重新编译 bundle。Mission 已物化后，Participant、replacement/rebind、reviewer、最终
验证者、baseline、delta、ownership interval、lease 和 audit 全部只读 `Mission.workspaceId`。若在
第 6 至第 8 步之间崩溃，将重放相同的 workspace、identity、策略、提示词、room 和 Lead request。
intent 与已存在 Mission 的 workspace 不一致时，恢复写入持久化 Attention 并停止，不修正任一记录，
也不回退到 Team profile。

workspace archive 使用同一 fence 顺序。archive 先获得 fence 时，启动在落 intent 前失败；启动先获得
fence 时，archive 先幂等取消该 workspace 中的非终态 Mission、释放 lease 并归档 Participant，再完成
workspace teardown。Team profile 与其 Methodology binding 不随创建 workspace 或 Mission workspace
归档。若 start intent 已落盘但 Mission 尚未物化，archive preparation 仍把
`Team.startIntent.workspaceId` 纳入 fence 集合，并从该 intent 物化相同的确定性 Mission 后直接
进入 cancel；该补偿不创建 room，也不会供应 Lead。重启时若 workspace archive intent、Team archive intent 或 start
intent 共存，reconciliation 优先续跑 archive，由 archive 路径接管 pending start；独立 start recovery
不得同时 provision Participant。

```ts
interface MissionMethodologySnapshot {
  revision: 1;
  ref: ExactMethodologyRef;
  compilerVersion: number;
  teamRevision: number;
  rosterSnapshotRevision: number;
  hardPolicy: CompiledMissionPolicyV1;
  promptSections: FrozenPromptSection[];
  hardPolicyDigest: Sha256;
  promptDigest: Sha256;
  compiledDigest: Sha256;
}
```

编译器只返回上述确定性字段。Mission 启动 saga 在编译后于 snapshot 旁记录自身的
`methodologyCompiledAt`；该操作时间戳不计入 `compiledDigest`，也绝不作为恢复编译的输入。

最终 Agent prompt 的规范装配顺序是：Paseo 运行时 section、冻结的 Methodology `promptSections`、
不可变 Assignment 事实。第一部分从持久化 Mission/start intent 派生，允许包含当前 workspace；后两部分
不能读取 Team 创建 workspace 或当前 workspace path。恢复重新装配第一部分，但逐字节复用持久化的
Methodology section 和 digest。

Mission、Workstream 计划 snapshot 和 Assignment Contract 引用 Methodology snapshot revision。V1 在
Mission 整个生命周期内保持 revision 1。控制器 capability refresh 可以追加后续 Mission 名册
snapshot，但不会重新编译 Methodology，也不会更改其 ref、策略、提示词 section 或原始
`rosterSnapshotRevision`。

V1 冻结活跃 Mission 的名册组成。Team profile 新增项和 Member 事实变更仍是面向未来 Mission 的有效
Team 更新，但运行中的 Mission 不采用这些变更。capability refresh 复制相同的 Mission Member、
Skill、Lead、execution profile、execution profile source 和 binding，只更改 provider 声明的结构化
capability 事实。添加或
替换 Mission Member 需要供应 Participant 并重新编译 Methodology，不在本版本范围内。

## 策略层级

| 层级               | 示例                                                                                          | 权威来源                                         |
| ------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 运行时不变量       | DAG 无环性、已接受 Assignment 不可变、scope 租约、已接受 turn identity、outbox 恢复、终态证据 | TeamRuntime；任何 Methodology 都不能削弱这些约束 |
| Methodology 硬策略 | 可写审查要求、审查豁免策略、必需的最终验证                                                    | 编译后的 snapshot 和 daemon validator            |
| Playbook 指导      | 规格深度、规划启发式、审查清单、沟通风格、文档工作流                                          | 提示词 section；可观察但不是完成事实             |

room 文字、Playbook 输出和生成文件绝不会通过解释改变 Mission 状态。Agent 必须使用结构化 Mission 工具
和 report。

## 独立审查门禁

### 合格性

审查者选择将结构合格性与调度就绪状态分开，并显式表示结构化 capability 知识。

独立审查者在满足以下条件时结构上合格：

1. Member 不是交付或集成 Workstream 的 owner；
2. Member 满足所有必需 Skill 和最低 Level；
3. Member 属于活跃 Mission 名册 snapshot；并且
4. Member 具有结构上有效的 execution profile，其 provider capability declaration 支持所有必需的
   运行时 capability。

Lead 是一种指定，不是排除条件。未拥有可写 Workstream 的 Lead 可以审查该 Workstream。忙碌状态、
Participant 状态、队列负载，以及创建或调度 provider session 时的失败会影响调度就绪状态，不影响
结构合格性。运行时无法调度的结构合格审查者仍保持已分配状态。其审查通过正常队列或
`provider_unavailable` 恢复等待；这些条件绝不会开启审查豁免。

provider capability 结果有三种含义：已知且支持要求；已知但不支持要求；因无法加载本地 provider
capability declaration 而在结构上未知。即使 provider 已禁用，resolver 仍读取已注册 provider 声明的
capability。当前本地 `createClient(logger).capabilities` 路径可以提供该 declaration，因为它不进行
认证、不启动 session，也不执行网络 I/O；V1 不要求第二个 provider registry。因此，已禁用但已注册
的 provider 在无法调度时仍可保持结构上已知。现有 `providerAvailable` 位描述可变的
registry/configuration 就绪状态，不作为 capability 事实使用。

名册 snapshot 将 `capabilityFacts` 持久化为 `known` 或 `unknown`。未知绝不视为不合格，也绝不会
使豁免可用。审查门禁规划和豁免复核使用这些冻结事实；调度使用实时 provider 与 Participant port。
provider 配置或 declaration 变更后，重新规划可以追加新的名册 snapshot。

### capability refresh 与重新规划 request

capability refresh 是控制器操作，与普通 `mission_plan` 解耦。UI 和 CLI 针对一个打开的
`review_gate_reviewer_unavailable`、`review_gate_capability_unknown`、
`final_verifier_unavailable` 或 `final_verifier_capability_unknown` Attention 调用
`team.mission.capability.refresh.request`。这四种是结构门禁 kind；不包括现有运行时
`reviewer_unavailable` kind。request 携带 Mission id、Attention id、预期 Mission revision 和幂等
key，绝不接受调用方提供的名册内容。

```ts
interface RefreshMissionCapabilitiesInput {
  missionId: string;
  attentionId: string;
  expectedRevision: number;
  idempotencyKey: string;
}

type RefreshMissionCapabilitiesResult =
  | {
      disposition: "unchanged";
      reason: "capability_declarations_unchanged";
      missionRevision: number;
      rosterSnapshotRevision: number;
    }
  | {
      disposition: "replan_requested";
      missionRevision: number;
      rosterSnapshotRevision: number;
      requestId: string;
      sourceAttentionIds: string[];
    };
```

client 不自动重试 `unchanged`。由于没有 Mission 副作用，它不写持久幂等 receipt；provider 配置变更后，
控制器提交新的 key。`replan_requested` 结果将其 key 与持久 request 一同持久化，因此网络重试会返回
原始 snapshot 和 request，绝不创建另一个 request。重放前，daemon 将规范 Mission id、选中的
Attention id 和预期 revision 与持久化的 request fingerprint 比较；同一个 key 配不同输入会返回
`team_mission_capability_refresh_idempotency_conflict`。

application service 在现有逐 Team lock 下执行 refresh：

1. 在预期 revision 下重新读取权威 Mission、选中的打开状态结构门禁 Attention 和活跃名册
   snapshot。
2. 克隆相同的名册组成、Lead、Skill、Member id、运行时 Agent id 和 execution profile；为每个 Member
   解析最新的结构化 capability declaration。
3. 如果规范结构事实逐字节相同，返回 `capability_declarations_unchanged`；Attention、名册、计划、
   outbox 和 Mission revision 均保持不变。
4. 否则，在 `max(revision) + 1` 追加一个 `reason: "replan"` 名册 snapshot，推进
   `activeRosterSnapshotRevision`，并在同一次 Mission aggregate compare-and-swap 中追加一个确定性的
   持久 Lead 重新规划 request 及其现有格式 `recipientAttentionOutbox` delivery。refresh 不解决
   Attention，也不更改 Workstream、Assignment、Participant 或计划 revision。

```ts
interface MissionCapabilityReplanRequest {
  requestId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  sourceAttentionIds: string[];
  rosterSnapshotRevision: number;
  deliveryId: string;
  createdAt: string;
  consumedAt: string | null;
}
```

一次 refresh 覆盖所有当前打开的结构门禁 item，因为它们都读取相同的名册事实。request 记录这些 item
排序后的 id。它是 intent 记录，不是第二个通知 outbox。其 `deliveryId` 指向现有
`recipientAttentionOutbox`；后者仍是 pending、notified、acknowledged、canceled、retry 和
binding-successor 状态的唯一事实源。delivery 遵循用于分阶段 Assignment 覆盖的现有 Lead 自投递结构：
当前 Lead Participant 同时作为发送者和接收者；room body 指明 request 和名册 revision，并指示 Lead
调用 `mission_status` 后提交完整的 `mission_plan`；通用 recipient-attention 唤醒指示 Lead 读取 room。
V1 不新增第二套 delivery engine 或 room author kind。

此 refresh 有意采用保守策略。它为完整的结构化 declaration 集合创建 snapshot，而不是猜测与所选
门禁相关的子集。因此，即使一个已知为空的门禁实际由固定的 Skill 或 Level 不匹配造成且仍未满足，
declaration 变更也可能请求重新规划。单 request 限制约束了这些额外工作；UI 说明 capability refresh
无法更改冻结的 Mission 名册、Skill 或 Level。

refresh aggregate CAS 同时创建 request 和 delivery。现有 reconcile 会发布确定性的 room 消息、尝试
delivery、重试忙碌的 Lead，并在 Lead 替换后创建 binding successor。daemon 重启不会丢失任一记录。
`consumedAt` 为 null 时 request 处于 pending；recipient 通知状态仍只存在于现有 outbox 中。如果匹配
计划在 delivery acknowledged 前消费 request，同一个计划 CAS 会用 `attention_resolved` 取消其
binding-successor chain 中每个 pending 或 notified delivery；之后 reconcile 无法再唤醒 Lead。

每个 Mission 最多存在一个未消费的 capability replan request。存在该 request 时再次 refresh，会直接
返回该 request 及其排序后的 `sourceAttentionIds`，不重新读取 declaration，也不追加 snapshot 或
delivery。Lead 必须通过计划消费该 request，之后才能再次执行 capability refresh。这可防止控制器
快速重试、选择不同结构 Attention 或多个 socket 造成 snapshot 与通知抖动。request 创建后新产生的
Attention 仍独立处于打开状态；完整的 Lead 计划可以解决它或将其延续，但不会追溯添加到 request 的
不可变 source 集合。

request 不设超时，daemon 绝不启动相互竞争的 Lead 计划 turn。如果当前 Lead 已读控制消息但未提交
计划，操作者可以发送持久 Team room 提醒、替换 Lead 或取消 Mission。Lead 替换必须检查每个未消费的
capability replan request；即使旧 binding chain 以 acknowledged 结束，也要确保新 binding 有一个
delivery。这比普通 pending/notified binding-successor 快捷路径更严格。该规则是可重放 reconcile 的
不变量，而不只是内联替换步骤：替换、启动恢复和周期性 reconcile 都强制执行
`unconsumed request + current Lead binding + no unsettled delivery for that binding => append one deterministic delivery`。
因此，binding 更新与追加 delivery 之间的崩溃可修复。在现有 request 被消费前，第二次 capability
declaration 变更有意不创建 snapshot；如果后续计划仍被阻塞，操作者针对其新 Attention 再次 refresh。

持久 request 是该 daemon 生成控制消息的来源记录。它在 `TeamMission` 上仅追加持久化，只向获准使用
完整 V1 Team 功能的 physical source 公开；原始 recipient 恢复状态保持内部可见。UI 将 request
标记为 Paseo 控制操作，并在设置 `consumedAt` 前显示为等待 Lead 重新规划。daemon 侧 Mission inspect
与 audit 可以将 `deliveryId` join 到内部 delivery 状态，但普通 Mission snapshot 绝不复制
pending/notified/acknowledged 状态。
delivery 使用统一的 Lead 自消息结构以复用 recipient outbox；audit 或 UI 都不会把其 body 归因于个人
或自主 Agent 决策。

随后 Lead 调用现有 `mission_plan`。规划始终在串行化 domain 边界内读取
`activeRosterSnapshotRevision`；调用方无法绑定陈旧 snapshot。计划 CAS 用 `replan` 解决旧结构门禁
Attention，依据活跃事实实体化门禁，并把匹配的持久 request 标记为已消费。如果事实现在表明存在
合格 Member，新门禁变为已分配。已知为空的审查门禁仍可豁免；已知为空的最终门禁仍不可豁免。如果
事实仍未知，新计划会获得绑定到新门禁 fingerprint 的新确定性 capability-unknown Attention。

仅当计划使用 request 的名册 snapshot revision 并解决每个 `sourceAttentionId` 时，request 才变为已
消费。如果被阻塞的结构门禁在替代计划中仍被阻塞，同一个计划 CAS 会解决旧的计划专属 item，并
追加后续门禁和打开的 Attention。不存在受影响依赖闭包已解除阻塞的已提交状态。

普通 `mission_plan` 不会隐式运行 capability refresh，也绝不会仅因存在无关的 capability-unknown
item 而被拒绝。它可以重新规划独立交付工作。当完整替代计划延续一个未解决、受 capability 阻塞的
Workstream 时，旧的计划专属 item 被解决并作为历史重新规划证据，新计划则实体化对应的当前打开
item。因此，该阻塞仍限定于相应依赖闭包，不会冻结其他重新规划路径。

domain `replan` resolution 携带 `rosterSnapshotRevision: number | null`。无论 revision 是否由最近一次
refresh 创建，四种结构门禁 kind 都记录替代计划所用的正数活跃名册 revision；其他 replan resolution
使用 null。该字段从首版起必需。

纯 capability refresh 不供应 Participant、不更改 `bindingEpoch`，也不改写之前的 snapshot。Lead
替换仍是唯一更改 Participant binding 的重新规划路径，因此保留现有 epoch 增量。并发的 Lead 替换、
取消、refresh 或计划会在 Mission revision compare-and-swap 中失败，并从权威状态重试。历史
Workstream 和 Assignment 保留原始 snapshot reference，验证根据仅追加 snapshot 集合解析每个
reference。Methodology snapshot 不会重新编译。

### 计划表示

当前可空的审查者字段允许无效组合。目标 Workstream 结构使用可辨识的审查门禁：

```ts
interface MissionReviewSubjectKey {
  workstreamId: string;
  subjectAssignmentIds: string[];
}

interface MissionReviewGateKey {
  subject: MissionReviewSubjectKey;
  planRevision: number;
}

type MissionReviewGateOutcome =
  | { kind: "pending" }
  | {
      kind: "approved";
      gateKeyFingerprint: Sha256;
      subjectFingerprint: Sha256;
      reviewAssignmentId: string;
      reportFingerprint: string;
      inheritedFromGateFingerprint: Sha256 | null;
      decidedAt: string;
    }
  | {
      kind: "waived";
      gateKeyFingerprint: Sha256;
      subjectFingerprint: Sha256;
      waiverId: string;
      decidedAt: string;
    };

type MissionReviewGate =
  | { kind: "none"; outcome: { kind: "not_required" } }
  | {
      kind: "required";
      gateKey: MissionReviewGateKey;
      gateKeyFingerprint: Sha256;
      subjectFingerprint: Sha256;
      requirements: MissionMemberRequirements;
      selection:
        | {
            kind: "assigned";
            reviewerMemberId: string;
            matchExplanation: MissionMemberMatchExplanation;
            overrideReason: string | null;
          }
        | { kind: "awaiting_reviewer" }
        | { kind: "awaiting_capabilities"; candidateMemberIds: string[] };
      outcome: MissionReviewGateOutcome;
    };
```

`subjectAssignmentIds` 是排序后无重复的不可变交付 Assignment id 集合。subject fingerprint 以规范
方式绑定 Workstream 和 subject 集合，在重新规划复用这些精确 Assignment 时保持稳定。门禁
fingerprint 还包含 `planRevision`，因此可标识一个门禁实例。审查 Assignment 和 report 绑定 subject
fingerprint。有 scope 的 Attention、豁免和门禁 outcome 绑定门禁 fingerprint。最终验证证据同时携带
两者。仅当 report 的 subject 与 subject key 完全相等时，审查 report 才有效。

`MissionReviewGate` 是 daemon 拥有的输出，不是 Agent 工具输入。`mission_plan` 提交 Workstream
objective、dependency、scope、requirements；只有编译策略允许 Lead 决定审查时，才提交审查偏好。
daemon 应用硬策略、计算候选者并实体化门禁。在 `portable/software-delivery@1` 下，Lead 的 none 偏好
不能禁用审查；daemon 会生成 `assigned` 或 `awaiting_reviewer`，并返回权威计划 snapshot。

`portable/software-delivery@1` 要求每个可写交付和集成 Workstream 都为 `required`，且 selection
已分配或等待中。只读 Workstream 可使用 `none`。包含等待 selection 的计划有效，其交付 Assignment
可以运行。

daemon 从结构化 Team 事实派生审查者合格性，不信任 Lead 的候选列表。仅当每个候选者在结构上已知
且无人合格时，`awaiting_reviewer` 才有效。没有已知的合格候选者，但至少一个候选者的 capability
事实未知时，必须使用 `awaiting_capabilities`。如果合格集合非空，计划必须绑定一个结构合格的
Member，daemon 则写入匹配说明。Lead 不能只为让之后可豁免而选择等待 selection。

交付到达审查门禁时，daemon 根据 Workstream 引用的名册 snapshot 重新计算合格性。已知为空的审查者
集合打开可豁免的 `review_gate_reviewer_unavailable` Attention。未知 capability 事实打开不可豁免的
`review_gate_capability_unknown` Attention，并提供重新规划与取消 resolution。两者都会阻塞该
Workstream 及其依赖项，同时独立路径继续运行。合格但忙碌的审查者不会创建任何一种结构门禁
Attention。

```text
交付完成
  |-- 合格审查者 --------------------> 审查排队/运行
  |                                     |-- approved ---------> Workstream 已接受
  |                                     `-- changes_requested -> 需要重新规划
  |-- 已知为空的审查者集合 -> review_gate_reviewer_unavailable Attention
  |                           |-- replan ------> 添加/选择审查者
  |                           |-- waive_review -> 用豁免证据满足精确门禁
  |                           `-- cancel ------> Mission 完成 saga
  `-- capability 事实未知 -> review_gate_capability_unknown Attention
                              |-- replan ------> 刷新名册事实
                              `-- cancel ------> Mission 完成 saga
```

### 有 scope 的 Attention 前置条件

当前 Attention 状态会暂停整个 Mission。对于 Lead 丢失、无法恢复的所有权、持久化和生命周期失败，
该行为仍然正确，但对单个不可用审查者而言范围过大。V1 添加显式阻塞 scope：

```ts
type MissionAttentionScope =
  | { kind: "mission" }
  | {
      kind: "workstream";
      workstreamId: string;
      blockDependents: true;
    };

interface ReviewGateUnavailableAttentionDetails {
  gateKey: MissionReviewGateKey;
  gateKeyFingerprint: Sha256;
  subjectFingerprint: Sha256;
}

interface FinalVerifierAttentionDetails {
  finalGateKey: MissionFinalVerificationGateKey;
  finalGateFingerprint: Sha256;
}
```

持久化 Attention domain 结构按 scope 区分。Mission scope item 保留现有必需的 `priorMissionStatus`，
因为它暂停 Mission，之后再恢复。Workstream scope item 存储 `priorMissionStatus: null`，因为它绝不
更改 Mission 状态。`scope` 与 `priorMissionStatus` 从首版起都是 wire/domain 必需字段；schema 直接
表达两种有效组合，不接受缺失 scope，也不在 protocol-to-domain 边界补值。

现有 Attention kind 默认采用 Mission scope。现有 `reviewer_unavailable` kind 保持当前含义：审查或
验证 Participant 在运行时不可用。它仍为 Mission scope，使用基于 Assignment 的 identity，只允许
`replan` 或 `cancel_mission`，绝不允许审查豁免。新的结构 kind
`review_gate_reviewer_unavailable`、`review_gate_capability_unknown`、
`final_verifier_capability_unknown` 和 `final_verifier_unavailable` 使用 Workstream scope。
kind-to-resolution 授权表只为 `review_gate_reviewer_unavailable` 添加 `waive_review`；另外三种结构
kind 明确排除它。

打开的 Mission scope item 保留当前 `needs_attention` 加 `suspendedStatus` 行为。打开的 Workstream
scope item 绝不更改 Mission 状态，而是将引用的 Workstream 标记为 blocked，并阻止调度其传递依赖项。
它可以与 Mission scope item 共存：没有打开的 Mission scope item 时 Mission 保持未暂停状态；存在一个或
多个时为 `needs_attention`。只要 Mission 未全局暂停，scheduler 就继续处理该依赖闭包之外就绪的
Workstream。

这需要两项明确的 scheduler 变更。只有打开的 Mission scope item 会让质量门禁实体化全局停止；
Workstream scope item 会过滤受影响的依赖闭包，而不是退出整轮处理。依赖就绪判断使用上游
Workstream 的 `accepted` 状态，而不只是已完成的交付 Assignment。被审查的 Workstream 仅在其
`reviewGate.outcome` approved 或 waived 后变为 accepted。这些规则可防止上游审查门禁仍为 pending
时启动下游工作。

Attention mutation 通过一个由 `TeamMissionService`、`TeamCollaborationService` 和
`TeamMissionScheduler` 共用的 domain transition helper 感知 scope。每个 scheduler raise 位置都把
item 追加和 Mission 状态派生交给该 helper；它不再把 `attentionItems` 追加与内联
`needs_attention` 分支耦合。raise 或解决 Workstream scope item 绝不写 Mission 状态。raise 第一个
Mission scope item 时，将当前 active 状态存为 `suspendedStatus` 并进入 `needs_attention`；后续
Mission scope item 复用该暂停状态。解决一个 Mission scope item 后，只要还有其他 Mission scope
item 打开，就保持暂停；最后一个解决后，即使仍有 Workstream scope item，也只恢复一次
`mission.suspendedStatus`，并将 `suspendedStatus` 清为 null。它绝不从已解决 item 的
`priorMissionStatus` 恢复。

两个现有 service 恢复路径都将 `some(open item)` predicate 替换为 `some(open Mission-scoped item)`，
并把状态派生交给该 helper。这可防止有 scope 的审查 item 让 Mission 永久暂停，或将 null 写为
Mission 状态。

Mission 验证仅对 Mission scope item 应用 `open_attention_status_mismatch` 和
`attention_suspended_status_mismatch`。每个打开的 Mission scope item 都必须与 Mission 的暂停状态
匹配。每个打开的 Workstream scope item 都要求非终态 Mission、`priorMissionStatus: null`，以及
当前计划中 blocked 的 Workstream；无论 Mission 为 active 还是全局 `needs_attention`，它都保持
有效。两种打开的审查门禁 kind 还要求一个 fingerprint 匹配、处于 pending 的必需门禁。打开的
`final_verifier_capability_unknown` 和 `final_verifier_unavailable` 则绑定验证 Workstream 及其
pending 的最终验证门禁；它们要求尚未实体化验证 Assignment，不要求审查门禁。

已解决的 Workstream scope item 是历史证据。它仍要求 Workstream scope、
`priorMissionStatus: null`、内部有效的 fingerprint，以及其 kind 授权的 resolution。它不要求引用的
Workstream 或门禁仍为当前、blocked、pending 或非终态。已豁免 item 通过持久化豁免和已 settled
门禁 outcome 交叉检查；replan 和 cancel item 可以引用历史计划 revision。Mission 完成仍要求两个
scope 都没有打开的 item。

结构审查门禁 item identity 由 Mission id、审查门禁 fingerprint 和门禁 kind 确定性生成。item 存储
两个 fingerprint。最终验证者结构 item 使用 Mission id、最终验证门禁 fingerprint 及其不同 kind。
现有运行时 `reviewer_unavailable` 保留基于 Assignment 的 identity。这些 id space 共存，绝不相互
去重或解决。因此，重复 scheduler pass 不会创建重复门禁 item 或操作者决定；替换后的交付 subject
集合也不能消费旧 item。

Mission 完成要求两个 scope 都没有打开的 item。取消会在现有完成 saga 中解决所有剩余 item。
Mission 状态、Attention scope 和 Workstream 状态一起验证，因此打开的有 scope item 不能引用
accepted、canceled、未知或属于不同计划的 Workstream。UI 在历史记录中保留已解决 item，并在
Mission Attention 列表和受影响 Workstream 上显示打开的有 scope item，但不把整个 Mission 显示为
已暂停。

### 操作者豁免

`review_gate_reviewer_unavailable` 在 `replan` 和 `cancel_mission` 之外添加 `waive_review`
resolution。
`waive_review` 通过控制器界面使用的 Session RPC 提供，不注册为 Agent 工具。request 不携带 actor
id；daemon 记录连接的 client metadata 用于关联。在当前本地信任模型下，该 metadata 不是经过认证的
真人 principal，因此不得描述为真人执行该操作的证据。WebSocket server 生成逐连接 id；hello
`clientId` 单独存储为自报 label。一个 Session 可能服务来自多个物理 socket 或 relay source 的
request，因此 handler 从当前 request `source` 派生两个值，并通过豁免 request context 传递。它不把
连接 identity 缓存为 Session 级字段。

```ts
interface MissionReviewWaiver {
  waiverId: string;
  attentionId: string;
  gateKey: MissionReviewGateKey;
  gateKeyFingerprint: Sha256;
  subjectFingerprint: Sha256;
  connectionId: string;
  selfReportedClientLabel: string;
  reason: string;
  createdAt: string;
}
```

豁免是仅追加的，且只满足指名的审查门禁。它不创建 approved 审查 report、不更改 Methodology
snapshot、不豁免其他 Workstream，也不豁免最终验证。最终 Mission 证据和 UI 显示
`review_waived`、原因、daemon 签发的连接 id，以及明确标为自报的 client label。两个字段都不表示为
个人或进程 identity。只有因不存在结构合格审查者而由门禁产生 Attention 后，才允许豁免；Lead 不能
在 `mission_plan` 中预先授权自审。未知结构事实、运行时 provider 失败、审查被拒或
`changes_requested` report 都不属于审查者不可用，绝不能转为豁免。

豁免 resolution 作为一次带预期 revision 的 Mission 更新运行：复核 item 仍打开、门禁 fingerprint
仍匹配、subject 集合未变、每个候选者的结构事实均已知且合格集合仍为空；追加豁免；将
`reviewGate.outcome` 设为该 fingerprint 和豁免；解决 Attention；并将被阻塞的 Workstream 推进为
accepted。并发重新规划、subject 替换、名册变更、未知 capability 事实或新合格审查者会导致 revision
或门禁冲突，而不会记录陈旧豁免。重复相同幂等 key 会返回原始豁免。

控制器 refresh 绝不解决 Attention。后续 `mission_plan` 根据活跃名册 revision 解决结构门禁 item，
并可采用同一冻结 Member 集合中因结构 capability declaration 更新而新近合格的 Member。取消遵循现有
Mission 完成 saga。refresh、规划、豁免和
取消各自使用自己的预期 revision 与幂等 key。

### 门禁持久性与恢复

`MissionReviewGateOutcome` 是 Workstream transition、依赖就绪、最终验证实体化、Mission 验证、UI 和
audit export 使用的唯一审查事实。approved 审查 report 通过带预期 revision 的 Mission 写入将 outcome
从 pending 变为 approved。豁免通过上述原子 resolution 将其从 pending 变为 waived。任何调用方都
不从 room 文本推断 outcome，也不独立重建 outcome。

validator 仅在以下条件下接受 `approved`：已分配审查者完成 approved 审查 Assignment，其 Workstream
和 subject 与稳定 subject key 完全相等，且 report fingerprint 与持久化 report 匹配。outcome 的门禁
与 subject fingerprint 必须匹配当前门禁。仅当等待 selection 与精确的持久化豁免及两个 fingerprint
配对时，才接受 `waived`。approved 与 waived outcome 在一个门禁内为终态。重新规划为新 revision
创建新门禁实例，绝不改写已 settled 的审查证据。

仅当稳定 subject key、不可变 contract、Workstream scope、审查者 requirements 和 Methodology
snapshot revision 都逐字节相同，且原审查者在新名册 snapshot 中仍结构合格时，Paseo 才可将
approved report 继承到新计划。新门禁保留该审查者作为已分配 selection，并附带继承说明。其
approved outcome 携带新门禁 fingerprint、共享 subject fingerprint 和
`inheritedFromGateFingerprint`；它继续引用绑定稳定 subject 而非新计划 revision 的原始不可变审查
Assignment 与 report。任何差异都要求重新审查。豁免绝不继承，因为它只授权一个门禁实例，而且
重新规划期间审查者合格性可能已变化。

当前 `resolveMissionAssignmentCoverage` 审查 map 会成为原始证据 index，而非权威批准决定。门禁
reconcile 可以检查该 index 以验证当前或可继承的 approved report，然后用预期 revision 提交
`reviewGate.outcome`。依赖就绪、`planMissionQualityGates`、最终验证实体化、完成验证、UI 和 audit
只使用持久化 outcome。迁移后，任何调用方都不得直接从已完成审查 Assignment 推断批准。

`sameReusableWorkstreamContract` 继续感知 Assignment kind。每个 kind 都比较现有不可变 objective、
deliverable、验收标准、requirements、dependency、scope 和 Methodology snapshot revision。交付
Assignment 忽略审查门禁字段，因此更改审查者 requirements 绝不会使已完成交付失效。审查
Assignment 还比较稳定 subject fingerprint 以及审查门禁 `kind` 和 `requirements`；不比较审查者
`selection`、门禁 `outcome`、门禁实例 fingerprint、Attention 和豁免。选择可复用交付 Assignment
后，planner 派生稳定 subject fingerprint，并应用上述更严格的 approved report 继承检查。无法继承
批准时，重新规划仍可复用未变交付 Assignment，同时重新计算审查者 selection 并创建 pending 门禁。
当前 `planWorkstreamReview` 的 null 审查者 throw 会替换为 `awaiting_reviewer` 或
`awaiting_capabilities` 加匹配的确定性有 scope Attention 路径。

scheduler reconcile 负责完成中断的派生 transition。如果 approved 审查 Assignment 已持久化但
outcome 仍为 pending，它会写入确定性的 approved outcome 并接受 Workstream。如果一个已完成交付
带等待 selection 却没有 Attention，它会创建匹配的确定性审查者不可用或 capability 未知 scope
item，并阻塞 Workstream。如果豁免 outcome 已持久化，重放时不实体化审查 Assignment。

故障注入测试覆盖 Attention 创建、approved outcome 和豁免 resolution 的每次 Mission Store
compare-and-swap 前后。重启后，每种场景都收敛到一个门禁 outcome、至多一个豁免、无重复 Attention，
且 Workstream 状态相同。

## 最终验证门禁

每个当前计划都恰好包含一个验证 Workstream，依赖所有交付和集成 Workstream。调度前，质量门禁
validator 还要求每个适用 subject 都有 accepted Workstream 和 settled 审查 outcome。豁免是审计
证据，不是 Workstream 或 Assignment 节点。

```ts
interface MissionFinalVerificationGateKey {
  workstreamId: string;
  planRevision: number;
  methodologySnapshotRevision: number;
  subjectAssignmentIds: string[];
  reviewGateFingerprints: Sha256[];
  requirements: MissionMemberRequirements;
}

interface MissionFinalVerificationGate {
  key: MissionFinalVerificationGateKey;
  fingerprint: Sha256;
  selection:
    | {
        kind: "assigned";
        verifierMemberId: string;
        matchExplanation: MissionMemberMatchExplanation;
        independenceExceptionReason: string | null;
      }
    | { kind: "awaiting_verifier" }
    | { kind: "awaiting_capabilities"; candidateMemberIds: string[] };
}

type MissionReviewGateEvidence =
  | {
      kind: "approved";
      gateKey: MissionReviewGateKey;
      gateKeyFingerprint: Sha256;
      subjectFingerprint: Sha256;
      reviewAssignmentId: string;
      reportFingerprint: string;
      inheritedFromGateFingerprint: Sha256 | null;
    }
  | {
      kind: "waived";
      gateKey: MissionReviewGateKey;
      gateKeyFingerprint: Sha256;
      subjectFingerprint: Sha256;
      waiverId: string;
    };
```

scheduler 先在验证 Workstream 上实体化 `MissionFinalVerificationGate`，但不创建 Assignment。其排序后
subject id 只包含不可变交付和 approved 审查 Assignment id；排序后的审查门禁 fingerprint 覆盖每个
适用的 approved 或 waived 门禁。key 还绑定最终验证者 requirements 和 Methodology revision。因此，
subject、策略或计划变更都会创建新的最终门禁 fingerprint。

验证 Workstream 现有 `ownerMemberId` 仍表示负责协调计划节点的 Member，不是验证者 selection。质量
门禁 materializer 不再使用该字段作为 Assignment assignee，只使用已分配的最终门禁 selection。

已分配门禁恰好实体化一个验证 Assignment。其 Contract 将 `subjectAssignmentIds` 限制为真实
Assignment id，并添加最终门禁 fingerprint，以及为每个适用 Workstream 包含一个 typed item 的
`reviewGateEvidence`。等待门禁不实体化 Assignment。validator 拒绝等待门禁的 Assignment、assignee
或门禁 fingerprint 不匹配的 Assignment，以及多个当前验证 Assignment。

validator 根据 Workstream 的权威门禁 key 与 outcome、精确审查 subject 集合，以及 approved report
或持久化豁免检查每个审查证据 item。豁免 id 绝不插入 Assignment dependency 或 subject-id array。
验证 Assignment 为只读，并生成结构化 `approved` 或 `changes_requested` report。

matcher 将独立于可写 Workstream 所有权视为偏好，而非硬要求。如果没有独立 Member 满足硬性的
Skill、Level 和运行时 capability requirements，但有非独立 Member 满足，则分配该 Member 并记录
例外。如果没有 Member 满足硬要求，门禁保持等待。最终验证者选择采用相同的已知/未知结构
capability 与调度就绪分离。
合格 Member 生成 `assigned`；只有此时 scheduler 才能实体化 Assignment。未知事实生成
`awaiting_capabilities` 加不可豁免的 `final_verifier_capability_unknown` Attention。已知为空的
合格集合生成 `awaiting_verifier` 加不可豁免的 `final_verifier_unavailable` Attention。两个 item 都
绑定与 Assignment 无关的最终门禁 fingerprint。重新规划可以刷新名册或选择合格 Member。分配后的
运行时调度失败只会延迟验证，绝不削弱门禁。

验证 Assignment 本身仍为必需，且没有操作者豁免。Mission 完成还要求没有打开的 Attention、没有
pending 审查 outcome、没有未解决的所有权违规、精确覆盖审查证据，且终态证据成功。

## 提示词编译

编译器输出有序 section，而不是单个不透明提示词：

```ts
interface FrozenPromptSection {
  sectionId: string;
  audience: "lead" | "delivery" | "review" | "verification";
  phase: "startup" | "planning" | "assignment" | "review" | "completion";
  content: string;
  contentDigest: Sha256;
}
```

编译器只输出冻结的 Methodology section，并按稳定的 bundle 顺序排列。最终 prompt assembler 在其前
追加 Paseo 拥有的运行时 section，用于说明当前 Mission id、`Mission.workspaceId`、workspace path、
工具、持久状态和不可协商的运行时规则；该 section 不进入 `MissionMethodologySnapshot.promptSections`
或 `promptDigest`。Assignment 专属事实在调度时来自不可变 Assignment Contract，而不是 bundle。

编译器强制执行逐受众预算和提示词总预算。它报告超出预算的 section，不截断硬规则指令，也不静默
丢弃 Playbook。

## 资源与延迟预算

编译在本地执行、具备确定性且有界，不执行网络或 provider 调用。

| 资源                               | V1 限制或目标                                                   |
| ---------------------------------- | --------------------------------------------------------------- |
| 规范 bundle                        | 规范化后最多 1 MiB UTF-8                                        |
| 单个提示词资产                     | 最多 64 KiB UTF-8                                               |
| 单个受众的渲染后 section           | 最多 64 KiB UTF-8                                               |
| 一个 snapshot 中所有渲染后 section | 最多 256 KiB UTF-8                                              |
| 内嵌 bundle 编译延迟               | 在支持的桌面基线上 p95 低于 50 ms                               |
| Mission snapshot 增长              | V1 中一个 Methodology snapshot；该 snapshot 外无重复提示词 body |

模块按精确 digest 缓存已验证的规范产物。cache miss 只影响 Mission 启动；恢复读取持久化 snapshot。在写入
启动 intent 前检查限制，因此超大 bundle 不会留下不完整 Mission。

## exporter 与安装

```ts
interface CodexMethodologyExportConfig {
  modelByArchetypeId: Record<string, string>;
  approvalPolicy: "untrusted" | "on-failure" | "on-request" | "never";
}

interface ClaudeMethodologyExportConfig {
  modelByArchetypeId: Record<string, string>;
  permissionMode: string;
  maxTurnsByArchetypeId: Record<string, number>;
}

interface MethodologyExporter<TConfig> {
  export(input: { ref: ExactMethodologyRef; config: TConfig }): Promise<ExportArtifactPlan>;
}

type CodexMethodologyExporter = MethodologyExporter<CodexMethodologyExportConfig>;
type ClaudeMethodologyExporter = MethodologyExporter<ClaudeMethodologyExportConfig>;
```

Codex 和 Claude 注册独立的 typed adapter；调用方绝不传递带不透明 config 的目标 discriminator。每个
exporter 返回确定性文件计划和 conformance report。现有可移植安装器负责路径验证、受管文件 hash、
冲突检测、拒绝 symlink、加锁和原子替换。

```ts
interface MethodologyConformanceReport {
  guaranteed: string[];
  advisory: string[];
  unsupported: string[];
}
```

Codex 和 Claude 导出可以保证内容分发。除非目标提供等效强制能力，否则它们会把可写 scope 所有权、
持久调度、exactly-once 已接受 turn、outbox 恢复和 Mission 完成门禁报告为建议性或不支持。如果目标会
静默丢失标记为不可降级的策略，则必须让导出失败。

Provider model map 仍是 exporter 配置，不进入中性 bundle 或 Paseo Team Methodology。Paseo
execution profile 继续使用当前 provider catalog。

## 跨仓库发布边界

`portable-agent-team` 负责 Methodology 创作与分发。Paseo 负责运行时 schema 编译器，并将已审查产物
嵌入其 release。两个产品都不在运行时读取对方仓库。

```text
portable-agent-team/core
  -> 构建规范 bundle + digest manifest + conformance fixture
  -> 发布仅含数据的 @team-harness/methodologies package
  -> 从相同 bundle 构建 Codex/Claude 导出计划

固定在 package-lock.json 中的 Paseo 开发依赖
  -> sync-methodology-bundles 验证 package manifest 和文件 allowlist
  -> 将已审查 JSON/Markdown 产物复制到 server 内嵌 catalog
  -> TeamMethodologyModule 再次验证并提供精确 ref
```

npm package 不包含 JavaScript entrypoint、install script、binary、hook 或 provider 配置。其 allowlist
包括规范 bundle JSON、Bundle V1 JSON Schema、digest manifest、license 文件和 conformance fixture。
Markdown 提示词内容作为字符串嵌入规范 bundle JSON，不通过第二条文件解析路径发布。package 版本是分发
版本，不是 Methodology 版本；一个 package 可以携带多个不可变 bundle ref。

sync 输出提交到 Paseo，因此 source build、打包后的桌面 build 和 daemon 恢复不需要 npm 或网络访问。
bundle 更新是普通的可审查 PR，包含 dependency pin、内嵌产物 diff、source provenance、精确 bundle
ref 和重新生成的 conformance fixture。如果检入产物与干净 sync 不同，或一个 id/version pair 有多个
digest，CI 会失败。不支持 Git submodule、同级仓库路径、运行时 Git fetch 和可变 release URL。

Bundle V1 JSON Schema 及其有效/无效规范 corpus 由 `portable-agent-team` 负责。Paseo 提供严格的 typed
decoder，并且必须通过该共享 corpus。只有 Paseo 拥有 `CompiledMissionPolicyV1`，因为该 type 描述
daemon 强制行为，而非可移植内容。这样无需维护两份独立 bundle 规格，即可将可移植 declaration 与
host 专属的强制结果分离。

## 实现所有权

| Owner                                             | 职责                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `portable-agent-team/core`                        | 创作 archetype、Playbook、模板、preset 和中性策略 declaration。                                         |
| `portable-agent-team/scripts`                     | 验证中性 source；构建规范 bundle、exporter 计划、manifest 和 conformance fixture。                      |
| `packages/protocol/src/team`                      | 追加式 wire type、精确 ref、descriptor、binding、snapshot、审查门禁和豁免证据。                         |
| `packages/server/src/server/team/methodology`     | 内嵌 catalog、严格 validator、规范 digest 验证、编译器、提示词 renderer 和 cache。                      |
| Team application/domain service                   | 持久化 binding/snapshot，拥有审查 outcome，限定 Attention scope，索引原始证据，强制门禁并保留恢复栅栏。 |
| Provider capability resolver                      | 无需 provider 处于启用状态或启动 provider session，即可读取本地已声明 capability。                      |
| `packages/client`, `packages/app`, `packages/cli` | 受 capability gate 控制的 host-global catalog/profile/Mission 流程；不解析 bundle，也不做策略决定。     |

CLI 提供 catalog list/inspect 和 Team Methodology 选择。解析后显示精确版本与 digest。V1 不接受本地
bundle 路径。client SDK 在创建 profile 前执行 catalog lookup，使 UI 与 CLI 共享相同的权威 ref 和陈旧
表单栅栏。完整 Team V1 可用时，CLI 从全局 Team catalog 选择 Team，并要求 Mission start 提供
`--workspace` 和精确 Methodology ref；Methodology 选择本身不接受 workspace 参数。

## 产品流程

host runtime 独立 hydrate Team snapshot 与 Methodology catalog。Team list、idle Team deep link 和 Team
设置外壳只依赖 Team replica；Methodology catalog 的 loading/error 不会隐藏 Team，也不会阻断 sidebar
或 host route。Methodology 控件拥有独立的 loading/error/retry 状态；需要 descriptor 的创建、升级和
Mission mutation 在 catalog 未就绪时禁用并 fail-closed，但现有 Team 的 binding ref/digest 仍从 Team
snapshot 可见。每个 server/source 分别缓存 catalog，不把一个 host 的 capability 或结果复用到另一个
host。

App 在 host layout 中始终静态注册 host-owned `/h/[serverId]/teams` 路由叶子；不能按单个 host 的
capability 条件增删 `Stack.Screen`。完整 Team V1 capability set 控制 host 导航入口、host index 决策和
叶子内容，不控制 route registration。该路由是 `HostLevelTeamList` 的唯一挂载 owner，不受 remembered workspace
跳转、live workspace 数量、Team 数量或 Team replica 成功状态控制；空 Team 列表仍显示创建入口和空
状态。现有 host index 的 `renderTeams` 分支被删除。host index 与 route leaf 都按 physical host connection
判定完整 Team V1 支持三态：

1. physical host 尚未连接时显示带 Retry/Back 的 `waitingForHost`，不进入无限 loading；
2. host 已连接但 capability handshake 尚未落地时显示 loading，不做终局重定向；直接 route 访问也显示
   loading；
3. capability 确定不存在时隐藏 host 导航入口，host index 进入 Open Project fallback；直接 route 访问
   显示可读的 unsupported 状态和返回操作；
4. `teamMissions`、`globalTeamProfiles` 和 `teamMethodologies` 均存在时，有可恢复 workspace 可以继续
   恢复该 workspace；没有可恢复的 live workspace
   时，无论 Team 数量以及 replica 处于 pending、ready 或 failed，都重定向到 `/h/[serverId]/teams`。

因此，在支持全局 Team 的 host 上，index 不把 Open Project 当作 canonical 落地面；Open Project 只由
用户显式启动的 Add/Open 流程使用，并携带 return target。host index 只负责选择 canonical route，不再
成为第二个 Team list owner。

`/h/[serverId]/team/[teamId]` 保持可分享的 Team deep link。Hub 与 deep-link route shell 只等待 Team
replica，不等待 workspace 或 Methodology catalog；replica pending 时显示 loading，failed 时仍保留当前
route shell、显示可重试错误并禁用依赖 Team 事实的 mutation，绝不重定向到 Open Project。idle Team
deep link 继续遵守 V2-ITEM-11：优先使用仍有效的创建上下文 workspace，否则使用 host 内稳定排序的首个
live workspace；没有 live workspace 时停在 host-owned route。workspace surface 只是显示位置，不拥有或
过滤该 Team，也不会改变 binding。active Mission placement 在 Mission snapshot hydrate 后只按
`Mission.workspaceId` 进入 workspace surface。

零 live workspace 时，hub 的创建操作禁用并启动 host-aware Add/Open Workspace 流程。该流程携带当前
`serverId` 和 `/h/[serverId]/teams` return target；成功打开 workspace 后返回 hub 并允许继续创建，取消则
留在 hub。有 live workspace 的空 Hub 同时提供创建 Team 和打开现有 workspace 的入口；后一个操作直接
进入所选 workspace surface，不携带“返回 Hub 继续创建”的意图。list、inspect 和设置始终可用。
workspace sidebar 可以链接该 hub，但不拥有或过滤它。
`teams` 与 `team/[teamId]` 叶子注册在 `packages/app/src/app/h/[serverId]/_layout.tsx`，不能注册到根
layout；遵循 `docs/expo-router.md` 的 host layout ownership 规则，避免 native 冷启动白屏。

### 创建 Team

1. 从 host-global Team hub 或 workspace 页面进入创建流程，并选择一个 live workspace 作为创建上下文；
   workspace 页面会预选当前 workspace。该上下文只用于 provider/execution-profile 表单解析和 idle
   Team 的显示位置，不是 Team owner 或 Mission 默认值。零 live workspace 时仍可浏览和设置既有 Team，但 V1 禁用创建并提示先创建
   或打开 workspace。
2. 显示必需的 Methodology 控件，默认选中 `Paseo Standard`。
3. 选择 Methodology 后加载其 descriptor 和可选 Team preset。
4. 选择 preset 后填充建议的 Skill 和 Member slot。
5. 用户为每个 Member 确认 Role、Level、Skill、Lead，并选择 inline execution profile 或一个 Agent
   Profile source。
6. daemon 解析所有 Agent Profile source，并在一个 Team CAS 中保存每个 Member 的完整
   `executionProfile`、可选 source、host-global Team 事实、精确 Methodology binding 和 Team revision。
   preset 与 binding 不捕获当前 workspace。

确认页面区分 capability 与 Playbook。用户创建 Team 前，页面会显示 Mission 硬策略。

### 启动 Mission

表单把目标 workspace 作为运行位置选择，把 Team 和 Methodology 作为独立的只读组织事实，之后依次
显示 objective、constraint 和验收标准。策略摘要列出独立审查、审查豁免行为、最终验证和建议性规格
Playbook。client 始终发送所选 workspace、表单中看到的精确 ref 和 Team revision；缺少完整 Team V1
支持时不显示提交入口，也不发送字段省略请求。

### Team 设置

在不依赖 live workspace 的 host-global Team 设置中添加 Methodology 页面，显示 source、精确版本、
digest、preset、binding、策略和可用升级。创建上下文 workspace 被归档或 host 当前没有 live
workspace 时，idle Team 与该页面仍可访问。Mission 处于非终态时，V1 禁用升级。用户确认前，升级
预览列出受影响的 archetype、Skill、Playbook 和硬策略。活跃 Mission 的 panel、sidebar 和 deep link
使用 `Mission.workspaceId` 放置；Mission snapshot 尚未 hydrate 时显示 loading，不回退到 Team 创建
workspace。

同一设置面为每个 Member 显示 execution profile source 与 `current`、`update_available`、`missing`、
`ambiguous` 状态。显式刷新只更新该 Member 的 snapshot/source digest 和 Team revision；选择其他 Agent
Profile 会重新绑定；手动编辑运行参数会 detach。这些操作可以在 Mission 活跃时更新 Team，但只影响
未来 Mission，不改活跃 Mission 的名册或 Participant。Methodology binding 升级仍要求没有非终态 Mission。

### Attention 与完成

全部四种结构门禁 Attention kind 都提供 **刷新 capability** 的控制器操作入口和 **取消 Mission**
resolution；刷新操作本身不是 Attention resolution。
`review_gate_reviewer_unavailable` 还提供 **豁免审查**。refresh 标记为本地 provider declaration
refresh，不声称提交计划。变更结果显示 **已请求 Lead 重新规划**、request 是等待 Lead 重新规划还是
已被计划消费，以及活跃名册 revision。未变结果提示操作者先修复 provider 配置或 declaration 再重试。
它不承诺 Mission 启动后添加的 Team Member 能加入冻结的 Mission 名册。原始 delivery attempt 仍是
inspect/audit 细节，而不是产品状态。

豁免对话框要求填写原因，并说明最终验证仍为必需。Mission 完成页面显示 Methodology 版本和每次审查
豁免。连接 label 标记为自报，绝不渲染为已验证的个人 identity。运行时 Participant Attention 保留
现有 resume/replan/cancel 操作，绝不增加豁免。

## 安全与信任

- bundle 只包含 JSON 和 Markdown，不能包含 script、binary、hook、dynamic import、shell 命令、MCP
  definition 或 provider credential。
- bundle 验证拒绝不安全 id、重复 id、未知字段、未知 placeholder、无效 reference、无效 UTF-8，以及
  超过配置大小限制的内容。
- bundle 可以要求 capability，但不能授予工具、权限、文件系统访问或 provider feature。有效
  capability 是 daemon 策略、provider 支持、execution profile 与 bundle 要求的交集。
- 采用前，UI 显示 source、精确版本、digest、license 和提示词内容。外部 bundle 信任与签名不在 V1
  范围内；初期只发布内嵌 bundle。
- 出于审计目的，提示词和模板文本属于不受信任的指令内容。它绝不绕过 Mission 工具授权或结构化
  状态验证。
- Paseo 本地 daemon 信任以同一 OS 用户运行的 client。V1 审查豁免是显式的受信任控制器操作和
  Agent 工具授权边界，不是真人在场的证据。存储的 client label 来自 hello 且为自报；它用于关联，
  不用于归因。更强的对抗边界需要 daemon 中经过认证的操作者 principal，不在此 Methodology 功能
  范围内。

## 可观测性与审计

记录结构事实，但不把提示词 body 复制到常规日志：

- bundle id、版本、digest、编译器版本和编译后 digest；
- Team id、Mission id、`Mission.workspaceId` 和 Methodology snapshot revision；不把 Team 创建
  workspace 记录为 Mission 归属；
- 每个 Member 的 execution profile source kind、Profile id、resolver version 与 applied digest；不记录
  Agent Profile notes、显示 metadata 或 passthrough 内容；
- 编译耗时、outcome、稳定 error code，以及失败的 binding 或 JSON path；
- 策略摘要和提示词 section id/digest；
- 每个计划和 Assignment 上的 Methodology snapshot revision；
- 审查者 selection、精确 Attention kind/scope、审查豁免 connection id/自报 client label/原因、
  capability refresh 名册 revision、Lead request 消费、引用的 recipient delivery 状态和验证结果；以及
- exporter 目标与 conformance 数量。

Mission inspect 和 audit export 包含完整的持久化 Methodology snapshot 与审查豁免。普通 daemon 日志
使用 id 和 digest。

## 失败场景

| 场景                                            | 必需结果                                                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Team 在 workspace A 创建、Mission 从 B 启动     | 复用同一 binding；snapshot 不含 A；全部 Participant 与 workspace 副作用只落在 B。                               |
| 创建上下文 workspace A 被归档                   | idle Team 与 Methodology 设置仍可见，并可从 live workspace B 启动 Mission。                                     |
| 同 key 重放逐字节相同的完整 start request       | 返回或恢复原 intent；不创建第二个 Mission、room 或 Lead。                                                       |
| 同 key 先后传入 workspace B 与 C                | 返回 idempotency conflict；原 intent 和 Methodology snapshot 逐字节不变。                                       |
| workspace archive 与 Mission start 竞争         | 按 lifecycle fence 决出单一结果；无 orphan snapshot、错误 workspace Agent 或遗留 lease。                        |
| start intent 后、Mission 物化前 crash + archive | archive recovery 从 intent 物化并取消 Mission，不供应 Lead；start recovery 不并发执行。                         |
| intent 与 Mission workspace 不一致              | 写持久化 Attention 并停止恢复；不回退到 Team 创建 workspace，也不重新编译。                                     |
| Mission start 缺少 workspace 或 Methodology ref | schema 拒绝；不读取创建上下文补值，不创建 intent、Mission、room 或 Participant。                                |
| Team create 缺少完整 Methodology binding        | schema 拒绝；不默认补齐，也不写 Team。                                                                          |
| Agent Profile 在 Team create 前被编辑           | daemon 物化提交时看到的权威 Profile，并返回保存后的 source digest 与 execution snapshot。                       |
| Agent Profile 在 Team 创建后被编辑              | Team 与 Mission 不变；设置显示 `update_available`，仅显式刷新产生新 Team revision。                             |
| Agent Profile 被删除                            | Team 继续使用最后快照；设置显示 `missing`，Mission start 不访问 catalog。                                       |
| Agent Profile id 重复                           | 创建、绑定和刷新返回 `team_agent_profile_ambiguous`；不按位置选择，不写 Team。                                  |
| 用户手动编辑带 source 的 Member 运行配置        | 同一 Team CAS 写新 snapshot 并移除 source；之后不再显示 Profile 更新。                                          |
| Team replica hydration 失败                     | Hub 与 Team deep link 留在当前 route shell 并显示 Retry；Team-dependent mutation 禁用，不跳到 Open Project。    |
| Methodology catalog hydration 失败              | `/h/[serverId]/teams`、deep link 和 placement 继续；Methodology 控件显示可重试错误，相关 mutation 禁用。        |
| host capability 尚未完成握手                    | host index 保持 loading；不因暂时的 false 值跳到 Open Project，也不进入尚未确认支持的 Hub。                     |
| remembered host 离线或无法建立连接              | route 显示带 Retry/Back 的 `waitingForHost`；不把永久未知 capability 渲染成无出口 loading。                     |
| host 确定不支持完整 Team V1                     | 隐藏 Hub 导航并进入 Open Project fallback；直接访问静态 route 显示 unsupported 与返回操作。                     |
| host 冷启动且没有 live workspace 或 Team        | 支持 capability 时 host index 进入空 Hub；Team create 禁用，Add/Open 流程保留返回 Hub 的目标。                  |
| idle Team 的创建上下文已归档但仍存在 B/C        | deep link 使用稳定排序的首个 live workspace 作为显示位置；Team 仍属 host，启动 Mission 时再显式选择 workspace。 |
| Methodology 升级后 Team 表单陈旧                | 返回 `team_revision_conflict` 或 `methodology_ref_conflict`；不产生 Mission 副作用。                            |
| 内嵌产物 digest 错误                            | 在启动 intent 前失败；报告 `methodology_digest_mismatch`。                                                      |
| daemon 在编译 intent 后崩溃                     | 复用持久化 snapshot 和 identity；绝不针对已变内容重新编译。                                                     |
| 所有审查者事实均已知且无人合格                  | 以 `awaiting_reviewer` 接受计划；允许交付运行，之后提供 refresh、豁免或取消。                                   |
| 审查者忙碌                                      | 交付后将审查入队；不中断，也不打开 Attention。                                                                  |
| 结构审查者的 provider 不可用                    | 保持审查者已分配并使用 provider 恢复；不公开审查豁免。                                                          |
| 审查 Participant 在运行时不可用                 | 保留现有 Mission scope `reviewer_unavailable`；拒绝 `waive_review`。                                            |
| refresh 时 capability declaration 未变          | 保持 Attention 打开；返回 `capability_declarations_unchanged`；不写 Mission。                                   |
| refresh 时 capability declaration 发生变化      | 追加一个名册 revision、一个 request 和一个现有格式 Lead delivery；保持门禁打开。                                |
| refresh 后 Lead 忙碌或 daemon 重启              | 现有 recipient delivery 针对当前 Lead binding 重试；不设第二条通知路径。                                        |
| Lead 读取 request 后未重新规划便离开            | 即使旧 chain 已 acknowledged，替换仍为新 binding 创建一个 delivery。                                            |
| Lead 重新规划前控制器重复 refresh               | 返回 Mission 的唯一未消费 request；既不追加 snapshot，也不追加 delivery。                                       |
| 一个 refresh key 搭配不同输入复用               | 返回 `team_mission_capability_refresh_idempotency_conflict`；aggregate 逐字节保持不变。                         |
| 计划在 delivery settled 前消费 request          | 在计划 CAS 中取消其 pending/notified binding chain；之后不再唤醒 Lead。                                         |
| capability 阻塞打开时发生普通重新规划           | 提交无关变更；将被阻塞门禁带入新计划，并创建一个新的当前 Attention。                                            |
| refresh 成功后 Lead 重新规划                    | 使用活跃名册，解决旧 Attention，消费 request，并实体化新门禁。                                                  |
| 门禁处的已知审查者集合为空                      | 打开一个确定性的 `review_gate_reviewer_unavailable` item；未受影响的路径继续。                                  |
| 最终验证者 capability 事实未知                  | 在最终门禁上打开 `final_verifier_capability_unknown`；不创建 Assignment。                                       |
| 一个有 scope 的审查 Attention 打开              | 阻塞该 Workstream 及其依赖项；继续其他就绪 Workstream。                                                         |
| Mission 与 Workstream Attention 共存            | 全局暂停只跟随 Mission scope；解决一个 scope 时保留另一个。                                                     |
| 有 scope 的 Attention 通过豁免/重新规划解决     | 将其保留为历史证据；不再要求当前 blocked/pending 状态。                                                         |
| 审查 settled 前交付 subject 发生变化            | 创建新门禁 key；旧审查、Attention 或豁免都不能满足它。                                                          |
| 重新规划保留 subject、策略和审查者              | 继承带显式门禁 lineage 的 approved report；不重复审查。                                                         |
| 已豁免审查后重新规划                            | 创建 pending 门禁并重新计算合格性；绝不继承豁免。                                                               |
| 操作者用一个 key 两次豁免审查                   | 返回相同豁免和 resolution；不追加重复项。                                                                       |
| daemon 在门禁 CAS 前后崩溃                      | reconcile 到一个 outcome、至多一个 Attention 和至多一个豁免。                                                   |
| 活跃 Mission 期间 bundle 更新                   | 当前 Mission 逐字节保持不变；在终态前不可升级 Team。                                                            |
| 导出目标无法强制最终验证                        | 返回显式 conformance 损失；策略不可降级时失败。                                                                 |
| 恢复期间缺少 bundle                             | 从持久化 snapshot 继续，不访问 bundle。                                                                         |

## 验证策略

1. **bundle conformance：** 规范 digest fixture、重复/未知字段、不安全内容、损坏的 reference、提示词
   placeholder、大小限制、确定性输出，以及排除时间戳和可变 provider 配置/就绪状态的结构化名册
   projection。相同 Team/名册/Mission 语义在 workspace A 与 B 编译出相同 Methodology snapshot；只有
   Paseo 运行时 prompt section 随 `Mission.workspaceId` 改变。
2. **Methodology 与 Agent Profile 接口：** `describe` 提案、显式 Team binding、确定性编译、fail-closed
   error、通过公共接口替换内存 source，以及 Agent Profile materializer 的 canonical digest、缺失/重复 id、
   source + snapshot 原子写入、显式 refresh 与 manual detach。Agent Profile catalog fake 在 Team 物化后改为
   throw；Mission start、recovery、普通 replan、Participant replacement/rebind 和 capability refresh 仍只读冻结
   execution snapshot/source provenance，路径成功或返回自身的领域结果，且 catalog 调用计数保持零。
3. **Mission 生命周期：** 陈旧栅栏、workspace lifecycle fence → Team permit 锁序、必需
   `workspaceId` fingerprint、在新 mutation 校验前完成 receipt/intent replay 判定、副作用前
   编译、携带 workspace 的持久启动 intent、无需访问 bundle 或 Team 创建 workspace 的崩溃重放、
   archive/start 两种获胜顺序、archive 接管已落 intent 但未物化 Mission 的重启窗口、intent/Mission
   workspace 不一致隔离、
   控制器 capability refresh snapshot CAS、事实未变时零写入、幂等重放/冲突、持久 Lead request 加现有
   recipient delivery 重放、延迟唤醒前取消、可重放崩溃且旧 delivery 已 acknowledged 的 Lead 替换、
   结构门禁阻塞时的普通重新规划、Lead 重新规划后的 request 消费、历史 snapshot reference、
   Participant epoch 不变、重新规划保留 Methodology revision，以及 Team 升级门禁。
4. **策略行为：** 可写审查强制、只读豁免、忙碌审查者排队、运行时 provider 失败不豁免、逐 kind
   resolution 授权、未知 capability 不豁免、所有 scheduler Attention raise 位置、混合 scope
   Attention raise/resolve 顺序、打开与已解决 scope item 验证、无关路径推进、精确 subject 集合绑定、
   感知 kind 的 Assignment 复用、安全继承 approved report、拒绝移除审查者、豁免不继承、门禁 CAS
   故障注入、只使用单一持久化 outcome、操作者豁免幂等、typed 最终证据和不可豁免的最终验证；其中
   包括等待中的最终门禁没有 Assignment、已分配门禁恰好有一个绑定 Assignment、恰好一个验证
   Workstream，以及拒绝任何 scope 下每个打开 Attention 的完成 predicate。
5. **产品与 exporter 证据：** host-global Team catalog、零 live workspace 的 idle Team 设置、目标
   workspace 与只读 Methodology 分离的桌面/紧凑 Mission 表单、完整 Team V1 的
   supported/unsupported 边界、active Mission 按 `Mission.workspaceId` 放置、Attention 流程、snapshot
   inspect、capability refresh 的未变/等待/已消费 UI、逐 request 连接 label、自报 client label UI、逐
   physical source 的整体验权与同一 V1 snapshot、Agent Profile source 的创建/刷新/detach/missing/ambiguous
   状态、`/h/[serverId]/teams` 在 remembered
   workspace、零 workspace、存在 live workspace 但无可恢复 selection、空 Team 下的可达性、host index
   capability unknown/absent/present 三态与 canonical hub 的 cold-start 路由、静态 route 的
   loading/unsupported 状态、`HostLevelTeamList` 单一 owner、V2-ITEM-11 idle Team placement 不改变 host
   ownership、Team replica 与 Methodology catalog hydration 失败隔离、Codex/Claude 产物 golden test、
   安装器冲突测试和 conformance report。

真实 provider 验收包括同一 host-global Team 在不同 workspace 中依次执行 Mission：一个正常的独立审查
Mission，以及一个到达审查者 Attention、获得操作者豁免、
完成最终验证并在最终证据中保留豁免的单人/小型 Team Mission。两者都使用隔离 daemon 状态和一次性
工作区运行。

## 子项契约

### TM-ITEM-1 · 提取确定性的 exporter 文件计划

- **Owner / skill：** `portable-agent-team` / `cs-refactor`。
- **依赖：** 无。
- **可交付结果：** 将 role、Skill、模板与宿主 adapter 的解释收敛为纯 `ExportArtifactPlan`，build CLI
  和安全 installer 物化同一份计划。
- **验收要点：** Codex/Claude 现有生成树 path 与 bytes golden 不变；幂等、双宿主共存、冲突预检、
  symlink 拒绝和原子写继续通过；installer 不再通过临时生成树读回文件来规划安装。

### TM-ITEM-2 · 发布 `paseo/standard@1` 规范 bundle

- **Owner / skill：** `portable-agent-team` / `cs-feat`。
- **依赖：** TM-ITEM-1。
- **可交付结果：** Bundle V1 schema、规范 serializer、validator、digest、有效/无效 corpus，以及只含
  数据的 `@team-harness/methodologies` package。
- **验收要点：** standard 使用建议性规格、`lead_discretion` 审查和不可豁免的最终验证；规范化在
  Python producer 与 TypeScript fixture 中得到同一 digest；运行时无需 npm 或网络。

### TM-ITEM-3 · 编译 `portable/software-delivery@1`

- **Owner / skill：** `portable-agent-team` / `cs-feat`。
- **依赖：** TM-ITEM-2。
- **可交付结果：** 把现有 role、workflow Skill、模板和协议显式映射为 archetype、Playbook、preset、
  policy 与 prompt asset，发布一个同时包含 `paseo/standard@1` 与 `portable/software-delivery@1` exact ref
  的不可变 package version 与 manifest。
- **验收要点：** 每个创作源都有闭合引用；`cap` 只映射 `maxMembers`；规格保持软指导，可写交付要求
  独立审查且允许 known-empty waiver，最终验证不可豁免；provider/model/workspace 不进入 digest；package
  中 `(bundleId, version, digest)` 唯一，两个 bundle 通过同一 schema/corpus 且可由干净 consumer 读取。

### TM-ITEM-4 · 从 exact bundle 导出 Codex 产物

- **Owner / skill：** `portable-agent-team` / `cs-feat`。
- **依赖：** TM-ITEM-1、TM-ITEM-3。
- **可交付结果：** exact ref 与 typed Codex config 生成确定性 artifact plan 和 conformance report，并
  交给现有安全 installer。
- **验收要点：** invalid config/ref/digest 在写入前失败；宿主 config 不改变 bundle digest；报告不会
  声称 scope ownership、持久调度、outbox 恢复或 Mission completion 等 Paseo 专属保证。

### TM-ITEM-5 · 从 exact bundle 导出 Claude 产物

- **Owner / skill：** `portable-agent-team` / `cs-feat`。
- **依赖：** TM-ITEM-1、TM-ITEM-3、TM-ITEM-4。
- **可交付结果：** exact ref 与 typed Claude config 生成确定性 artifact plan 和 conformance report，
  保留只读 reviewer/SA 权限约束，并闭合 Codex→Claude 与 Claude→Codex 两种安全安装顺序。
- **验收要点：** model、permission 与 max-turn 配置严格校验；与 Codex 使用相同 ref、digest 和中性
  prompt asset；两种安装顺序都只保留一份共享内容、正确的平台 ownership、本地修改与重复安装零变化；
  两个 conformance report 对共享 runtime 能力使用同一分类且不声称 Paseo 专属保证。

### TM-ITEM-6 · 建立全局 Team Hub 与 Methodology catalog

- **Owner / skill：** Paseo / `cs-feat`。
- **依赖：** `agent-teams:V2-ITEM-11` 完成新契约重新批准、实现同步与 change review；TM-ITEM-3。
- **可交付结果：** Paseo lockfile 固定已发布 package，allowlist sync 两个 exact bundle 到内嵌 catalog，
  以严格 typed decoder/shared corpus 验证 digest；同时交付静态 host route、单一 `HostLevelTeamList` owner、
  独立 catalog hydration、`team.methodology.list/get` 与 CLI list/inspect。
- **验收要点：** clean sync 零 diff，额外文件、digest mismatch 或同 id/version 多 digest fail-closed；运行时
  不访问 registry；physical-source capability 三态决定 loading/unsupported/supported；Team replica 与
  catalog 各自失败时保留 route shell 与 Retry；零 workspace、空 Team、离线 host 和 native 冷启动无死路。

### TM-ITEM-7 · 用 preset 创建实际绑定的全局 Team

- **Owner / skill：** Paseo / `cs-feat`。
- **依赖：** TM-ITEM-3、TM-ITEM-6。
- **可交付结果：** App/CLI 从 exact Methodology preset 创建 Team，用户确认实际 Role、Level、Skill、
  Lead，并为每个 Member 选择 inline execution profile 或 Agent Profile source；daemon materializer 在一个
  Team CAS 中持久化完整 execution snapshot、可选 source 和 Methodology binding。
- **验收要点：** wire/domain 使用同一个必需 V1 shape，不提供旧字段或降级路径；输入 Member 通过唯一
  `clientMemberKey` 关联 daemon 分配的 `memberId`，禁止按 Role、显示名、Profile 名称或数组位置猜测；
  Profile id 缺失/重复/无效零写入，digest 只覆盖规范运行字段；创建不产生 Mission、room 或 Agent。

### TM-ITEM-8 · Mission 启动时冻结并编译 Methodology

- **Owner / skill：** Paseo / `cs-feat`。
- **依赖：** TM-ITEM-7。
- **可交付结果：** 在 workspace fence 与 Team permit 内冻结 exact ref、Team revision、结构化名册与
  capability facts，持久化包含 execution snapshot/source provenance 的名册、Methodology snapshot 和按
  顺序装配的 prompt section。
- **验收要点：** replay 在 fresh mutation 栅栏前执行；workspace、时间、runtime Agent id 与实时
  provider readiness 和 Agent Profile source 不进入 Methodology digest；启动、恢复与普通 replan 不读取
  Agent Profile catalog；把 catalog port 配成 throw 仍只读冻结 execution snapshot/source provenance。编译
  失败发生在 intent、Mission、room 和 Lead 副作用之前。

### TM-ITEM-9 · 恢复 Methodology start saga 与 archive takeover

- **Owner / skill：** Paseo / `cs-feat`。
- **依赖：** TM-ITEM-8。
- **可交付结果：** daemon 从任意启动崩溃点仅凭冻结 intent 恢复；workspace archive 能接管共存的
  pending start，物化并取消 Mission。
- **验收要点：** 恢复不访问 Team binding 或 bundle；archive 接管不创建 room/Lead；两种锁序和每个
  crash window 都没有 orphan Participant、错误 workspace、残留 lease 或重复 provider work。

### TM-ITEM-10 · 升级 idle Team 的 Methodology 与 execution source

- **Owner / skill：** Paseo / `cs-feat`。
- **依赖：** TM-ITEM-7、TM-ITEM-8。
- **可交付结果：** host-global 设置与 CLI profile update 提供 exact ref、binding 和策略差异预览，并
  显示每个 Member 的 Agent Profile source 状态；显式 refresh/rebind/detach 在 commit 时由 daemon 权威
  重验 materialization 与完整 next binding。
- **验收要点：** 页面不依赖 live/creation workspace；非终态 Mission 或 start intent 只阻止 Methodology
  binding 升级，不阻止仅面向未来 Mission 的 execution source refresh/rebind/detach；stale revision/ref
  零副作用；Profile edit/delete 不自动改 Team，refresh 产生新 Team revision，inline 编辑移除 source；
  digest 未变的 refresh 零写入；历史 snapshot 不变，后续 Mission 使用新 ref 与 execution snapshot。

### TM-ITEM-11 · 持久化独立审查门禁

- **Owner / skill：** Paseo / `cs-feat`。
- **依赖：** TM-ITEM-8。
- **可交付结果：** daemon 从冻结 policy 为可写 Workstream 生成可辨识 review gate，选择结构合格且与
  subject owner 不同的 reviewer，并持久化唯一 outcome；App/CLI Mission inspect 显示 subject、selection、
  pending/approved outcome 和对应 report evidence。
- **验收要点：** 缺 reviewer 不拒绝 `mission_plan`；忙碌或运行时不可用不改变结构资格；下游只在
  approved/waived outcome 后运行；用户可以从 Mission UI 看到交付等待独立审查及获批结果；approved
  report 仅在 subject 与策略逐字节相同时继承；protocol、daemon、App/CLI 与调度 E2E 在同一里程碑通过。

### TM-ITEM-12 · 用 Workstream-scoped Attention 隔离门禁阻塞

- **Owner / skill：** Paseo / `cs-feat`。
- **依赖：** TM-ITEM-11。
- **可交付结果：** Mission 与 Workstream scope Attention 共用 scope-aware transition，scheduler 只
  阻塞相关 Workstream 与依赖闭包；App/CLI 将 blocker 归属到具体 Workstream，并继续显示独立路径的
  running/ready 状态。
- **验收要点：** known-empty 与 capability-unknown 使用不同 kind；Workstream item 不暂停 Mission；
  混合 scope 恢复不传播 null status；UI 不把 scoped item 误报为整 Mission 暂停；任何 open item 仍阻塞
  完成；forked-DAG 真实 daemon E2E 证明无关 Workstream 继续派发。

### TM-ITEM-13 · 实体化不可豁免的最终验证

- **Owner / skill：** Paseo / `cs-feat`。
- **依赖：** TM-ITEM-12。
- **可交付结果：** 每个计划拥有与 Assignment 无关的 final gate；选择 verifier 后恰好实体化一个只读
  verification Assignment，并写入 typed evidence；App/CLI 显示 awaiting/assigned/approved 状态和最终
  验证证据，而不是从普通 Assignment coverage 猜测完成。
- **验收要点：** waiting gate 没有 Assignment；硬 capability 不满足时仅阻塞对应依赖闭包；用户、
  Lead、bundle 和 exporter 都不能豁免；完成要求所有 review evidence、verification report 与 Attention
  不变量成立；Mission UI 在最终验证通过前不显示可完成状态，定向 E2E 证明恰好一个 verifier。

### TM-ITEM-14 · 允许控制器豁免 known-empty review gate

- **Owner / skill：** Paseo / `cs-feat`。
- **依赖：** TM-ITEM-12、TM-ITEM-13。
- **可交付结果：** controller RPC 对精确 review gate 执行一次带原因的 waiver，并在单次 CAS 中写入
  waiver、settle outcome、解决 Attention 和推进 Workstream；App 提供带原因的确认对话框，CLI 提供
  capability-gated controller 命令，inspect/audit/final evidence 显示不可变操作者标签与原因。
- **验收要点：** Agent tool catalog 不暴露该操作；仅 current known-empty 且 policy 允许的 gate 可用；
  capability unknown、运行时 reviewer failure 与 final gate 不可豁免；replan 不继承 waiver；真实浏览器
  E2E 从 scoped Attention 打开 dialog、提交 waiver、继续 final verification，并验证未获完整 Team V1
  权限的 physical source 无法调用操作。

### TM-ITEM-15 · 刷新结构 capability 并请求 Lead 重新规划

- **Owner / skill：** Paseo / `cs-feat`。
- **依赖：** TM-ITEM-12、TM-ITEM-13。
- **可交付结果：** controller refresh 在事实变化时通过单次 aggregate CAS 追加 roster snapshot、唯一未
  消费 replan request 与现有格式 Lead recipient delivery；App/CLI Attention 操作触发 refresh，并显示
  `unchanged` 或“已请求 Lead 重新规划”、活跃 roster revision 与 request pending/consumed 状态。
- **验收要点：** 声明未变时 aggregate 逐字节零写入；refresh 不解决 Attention 或修改 plan、Participant、
  binding epoch、workspace、Methodology snapshot；同 key 不同 fingerprint 返回命名冲突错误；UI 文案不把
  refresh 描述为 plan commit，未获完整 Team V1 权限的 physical source 不接收 request 或 mutation control；
  Agent Profile catalog port 配成 throw 时仍只解析 provider declaration，不访问 Profile catalog。

### TM-ITEM-16 · 让 capability replan 经受重启与 Lead 替换

- **Owner / skill：** Paseo / `cs-feat`。
- **依赖：** TM-ITEM-15。
- **可交付结果：** replacement、startup recovery 与周期 reconciliation 共同强制当前 Lead binding 拥有
  一个确定性未结算 delivery；`mission_plan` 原子消费 request 并取消旧 chain；App/CLI inspect 在恢复前后
  持续显示同一 request identity、当前 binding delivery 与 consumed 结果。
- **验收要点：** 旧 delivery 已 acknowledged 时仍可 re-arm；崩溃后收敛且无 late wake；无关普通
  replan 不隐式 refresh 或被拒绝；blocked successor 使用当前 plan fingerprint；fault injection 覆盖
  acknowledged old delivery→Lead replacement/restart→replan，并以真实 provider smoke 证明 recipient
  delivery 会驱动 Lead 提交新计划而非只更新持久化状态。普通 replan、Lead replacement、Participant
  replacement/rebind 与 startup reconcile 均在 Agent Profile catalog port 抛错时使用冻结快照完成，不产生
  catalog 调用。

### TM-ITEM-17 · 闭合首发契约、导出一致性与真实协同验收

- **Owner / skill：** Paseo / `cs-feat`。
- **依赖：** TM-ITEM-4、TM-ITEM-5、TM-ITEM-9、TM-ITEM-10、TM-ITEM-13、TM-ITEM-14、
  TM-ITEM-16。
- **可交付结果：** Paseo 关闭单一 Team V1 schema、跨 workspace 产品流程、审计 UI 与真实协同发布门；
  portable exporter/install conformance 只消费 TM-ITEM-4/5 已冻结证据，不在本项跨仓库改实现。
- **验收要点：** 精确 V1 schema fixture 覆盖所有必需字段，仓库中不存在 Team migration、dual write、
  legacy projection、normalizer 或 `COMPAT(...)`；supported/unsupported physical source 验证整体验权、
  同一 snapshot shape 和同 Session 无泄漏。跨 workspace browser、Agent Profile source 全生命周期、archive/start
  crash、真实 provider 独立审查、waiver、最终验证，以及 capability refresh→acknowledged delivery→Lead
  replacement/restart→replan→final verification 场景通过；在 Team source 物化后关闭 Agent Profile catalog，
  Mission start/recovery/replan/replacement/rebind/capability refresh 的集成场景仍通过且读取计数为零，并保留
  desktop/compact/native 证据。

## 最终交付索引

proposed 阶段为空。执行期间的活动进度、证据与 commit 指针只写 work 游标；owner 最终接受时将每个
`TM-ITEM-*` 的稳定交付指针汇总到此处。该汇总只由 `cs-epic` 主流程在 final owner acceptance gate
执行，并与永久 Epic 终态更新、work 游标清理属于同一个收尾动作；执行期不得提前双写。

## 整体验收

- 每个 host-global Team profile 都有一个精确 Methodology binding，每个 workspace-bound Mission 都有
  一个完整冻结的 Methodology snapshot。Team 的 `creationWorkspaceId` 不是 binding、catalog 或编译所有权。
- 每个 Team Member 都有完整 `executionProfile`；可选 `executionProfileSource` 只表示 inline 或 Agent
  Profile 来源。Profile 更新不自动写 Team，显式 refresh/rebind/detach 才产生 Team revision。
- 同一 Team 可以在不同 workspace 中依次启动 Mission，沿用 Team binding 和 Member 映射；每个 Mission
  单独持久化其 `workspaceId`、名册与 Methodology snapshot。
- 编译 intent 持久化后，Mission 启动与恢复绝不依赖可变 bundle 内容。
- 编译只使用结构化名册 projection；snapshot 时间戳、实时 provider 可用性、Team 创建 workspace、
  Mission workspace、workspace path 和 Agent Profile source 不能改变编译后 digest。
- Mission start 先取得规范 workspace lifecycle fence，再取得 Team permit，并在两层许可内重读 Team、
  workspace 与 active Mission。`workspaceId` 和 `expectedMethodologyRef` 都是首版必需字段；不同
  workspace 具有不同 fingerprint，Team 创建上下文绝不补值。
- 在当前 Team revision/ref/active-Mission 栅栏前检查持久 receipt 与 start intent。精确 replay 返回或
  恢复原请求；相同 key 的不同规范 fingerprint 始终返回 conflict。
- start intent 是崩溃恢复的唯一 workspace 事实，Mission 物化后 `Mission.workspaceId` 是全部
  Participant、lease、baseline、delta、ownership 与 audit 路径的唯一 workspace 事实。任何不一致都
  fail-closed，不回退 Team 创建上下文。
- workspace archive 与 pending start intent 共存时，archive reconciliation 是唯一推进者：它从 intent
  物化确定性 Mission 后直接取消，不创建 room 或供应 Lead；重启不得让独立 start recovery 与其竞争。
- host-global Team catalog 和 Methodology 设置在零 live workspace 时仍可访问；活跃 Mission 只按
  `Mission.workspaceId` 放置，snapshot 未 hydrate 时保持 loading。
- `teamMissions`、`globalTeamProfiles` 与 `teamMethodologies` 共同表示完整 Team V1 可用。缺少任一项时
  整体显示 unsupported，不运行字段省略或 standard-only 降级。授权按 physical source 判定，不使用
  Session 聚合结果。
- Team replica 与 Methodology catalog 独立 hydrate；任一失败都不改变 route ownership。Team replica
  失败时 Hub/deep link 原地显示 Retry 并禁用 Team-dependent mutation；catalog 失败不隐藏 Team 或改变
  Mission placement。零 live workspace 时既有 Team/设置仍可达，但 V1 Team create 要求一个 live
  创建上下文。
- `/h/[serverId]/teams` 静态注册；host 离线时显示 `waitingForHost`，在线握手未完成时显示 loading，
  capability 确定缺失时显示 unsupported，确定存在
  时在 remembered workspace、零 live workspace、存在 live workspace 但无可恢复 selection、空 Team 和
  Team replica failed 场景下始终可达。`HostLevelTeamList` 只在该 route 挂载。host index 在 capability
  未知时 loading、确定缺失时进入 Open Project fallback、确定存在且无可恢复 workspace 时进入该 hub。workspace sidebar
  只能链接它，不能拥有或过滤全局 Team catalog。idle Team deep link 的 workspace presentation 遵守
  V2-ITEM-11，但不会转移 Team ownership 或影响 Mission workspace 选择。
- `paseo/standard@1` 保留中性审查选择；`portable/software-delivery@1` 要求可写 Workstream 接受
  独立审查，并要求 Mission 接受最终验证。
- 规格产物保持建议性，不能阻塞完成。
- 缺少审查者不会拒绝计划或停止无关交付工作。
- 下游调度等待上游 Workstream 的审查 outcome，而不只是交付完成。
- Mission scope 和 Workstream scope 的 Attention 可以共存；解决任一 scope 都不能破坏或过早恢复
  Mission 状态。
- capability refresh 在其 aggregate CAS 中只更改结构化名册事实、一个持久 Lead request 和一个现有
  格式 recipient delivery；它绝不解决 Attention 或修改计划。事实未变时不写 Mission。
- 结构门禁被阻塞时，普通重新规划仍可用。除非刷新后的事实满足门禁，否则会将该阻塞带入新计划，
  且绝不丢失无关的重新规划恢复。
- capability refresh delivery 通过现有 recipient outbox 经受 Lead 忙碌、Lead 替换和 daemon 重启。
  匹配 request 仅随解决全部源 Attention 的计划变为已消费；未 settled 的 delivery chain 在同一 CAS
  中取消。旧 delivery acknowledged 后，Lead 替换会重新武装未消费 request；reconcile 修复 binding
  替换与重新武装之间的崩溃。
- 每个 Mission 最多存在一个未消费 capability replan request。延续操作在同一个计划 CAS 中解决每个
  旧 item，并追加其当前计划 successor。
- 会产生 mutation 的 refresh 幂等 key 只重放逐字节相同的输入；不同输入返回
  `team_mission_capability_refresh_idempotency_conflict`。未获完整 Team V1 权限的 source 不接收
  capability replan request 或原始 recipient 恢复状态。
- 每次 scheduler Attention 写入都使用能感知 scope 的 transition helper；运行时
  `reviewer_unavailable` 保持 Mission scope，不能使用 `waive_review`。
- 只有打开的 Workstream scope Attention 要求当前存在 blocked Workstream 和 pending 门禁；豁免、
  重新规划或终态完成后，已解决 item 仍是有效历史证据。
- 每个审查 report 绑定稳定 Workstream 和精确交付 Assignment 集合。每个门禁、Attention、outcome
  和豁免绑定一个计划专属门禁实例。最终证据携带并验证两个 fingerprint。
- 重新规划只能继承基于逐字节相同不可变 subject 和策略的 approved report；绝不继承豁免。
- 仅更改审查者 selection 或 requirements，绝不会使未变的已完成交付 Assignment 失效。
- 未知 capability 事实和运行时 provider 失败绝不产生审查豁免资格；审查门禁和最终验证者 capability
  Attention 保持为不同的 domain kind。
- Agent 工具不提供不可用审查豁免；该操作要求控制器显式执行，并带不可变原因和可见最终证据。在
  Paseo 现有本地信任模型下，同用户本地进程仍可调用 daemon RPC。
- approved 与 waived 审查 outcome 经受每个已测试的崩溃边界，并输入一个 typed 最终门禁。
- 等待中的最终验证门禁没有 Assignment；已分配门禁恰好有一个绑定到验证者和门禁 fingerprint 的
  Assignment。每个计划恰好有一个验证 Workstream。
- 用户、Lead、bundle 或 exporter 都不能豁免最终验证。
- Mission 完成要求 Mission 与 Workstream 两种 scope 下都没有打开的 Attention item。
- 首版 wire schema 要求结构化名册 capability、Attention scope、review/final gate、Methodology binding
  和 Mission workspace/ref；缺失字段直接拒绝，不做协议外补齐。
- Team 代码不包含实验格式 migration、dual write、legacy adapter/projection、旧 RPC fallback 或 Team
  专属 `COMPAT(...)` 标签。
- bundle 不能执行代码、授予 capability 或修改 Team/Mission 状态。
- Codex 和 Claude 导出会说明强制能力损失，而不是声称不受支持的保证。
- 功能首次公开前，上述全部 schema、生命周期、策略、UI、恢复、exporter 和真实
  provider 门禁都必须通过。

## 遗留风险

- `agent-teams:V2-ITEM-11` 已因 Agent Profile/Methodology 契约同步重新打开；TM-ITEM-6 必须等待其新契约
  重新批准、实现同步并通过 change review，不能消费旧勾选状态或复制未冻结的中间实现。
- `@team-harness/methodologies` 跨仓库发布需要可重放的 package/version/digest 证据；Paseo 运行时只消费
  lockfile 固定且已同步的内嵌产物，不在 Mission 路径访问 registry。
- waiver 审计中的 connection id 与 client label 只用于相关性，不提供加密级操作者归属证明。
- 真实 provider 验收存在模型波动；确定性状态机、fault injection 与首版 schema 测试仍是发布硬门槛，真实
  provider 连续通过只补充行为证据。
