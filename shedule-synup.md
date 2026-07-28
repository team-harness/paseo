# 定时任务：上游同步 → 桌面打包 → 发布通知

本文件是一个可重复执行的 runbook，用于定时把原作者仓库的最新改动同步进本 fork，并把新的 macOS 桌面安装包分发出去。

## 前置事实

- Fork remote：`origin` -> `git@github.com:team-harness/paseo.git`
- **上游 remote：`upstream` -> `git@github.com:getpaseo/paseo.git`**
- 本 fork 的全部改动清单记录在 [changes-by-cs.md](changes-by-cs.md)，它同时也是同步时的决策依据。
- GitHub 网络需要走本机代理，执行 `git fetch` / `gh` 前先探测本机代理端口并配置。

> ⚠️ “同步上游最新改动”指的是 `upstream/main`（getpaseo/paseo），**不要**把 `origin` 当成上游。

---

## Step 1：同步上游改动

1. `git fetch upstream --prune`，对比 `changes-by-cs.md` 里记录的“最近同步基线”，确认是否真的有新提交。若没有新提交，记录一句“本轮无上游更新”，跳过 Step 2 / Step 3。
2. 通读 [changes-by-cs.md](changes-by-cs.md)，把 fork 的每一项改动逐条过一遍，判断它属于哪一类：
   - **保留**：上游没有等价能力 → 合并时必须保住 fork 的实现和行为，不允许回归。
   - **下线**：上游已经实现了同等能力（例如计划任务本身已支持选择已有的 Agent）→ **以原作者实现为准**，删除 fork 的重复实现、测试与文案，不保留双路径。
3. 执行 merge。遇到冲突时：
   - 属于“保留”类的功能，冲突处必须保住 fork 的行为；
   - 属于“下线”类的功能，冲突处直接采用上游版本；
   - 协议 / 持久化数据的冲突，先保证兼容性，再处理 UI 冲突，禁止用旧 RPC 拼装降级路径。
4. **同步更新 `changes-by-cs.md`**：刷新“最近同步基线”“最近同步 merge commit”，新增一条“最近同步判断”，并把本轮下线掉的能力从清单里移除或标注为已下线。这个更新要一起 commit。
5. 验证：
   - `npm run typecheck`
   - `npm run lint`
   - `npm run format`
   - 只跑受影响区域的目标测试文件（`npx vitest run <file> --bail=1`），**不要**跑全量测试套件。
6. 确认没有回归后提交合并结果。

---

## Step 2：构建 macOS arm64 桌面安装包

前提：Step 1 确实合入了上游改动。若本轮无上游更新，跳过本步。

1. 在仓库根目录执行桌面打包：

   ```bash
   npm run build:desktop
   ```

   该脚本会重建 server 栈、导出 Expo web（`PASEO_WEB_PLATFORM=electron`）并调用 `electron-builder`，产物在 `packages/desktop/dist/`（或 `electron-builder.yml` 中配置的输出目录）。

2. 确认产出的是 **macOS arm64** 安装包（`.dmg` / `.zip`，文件名含 `arm64`）。如宿主不是 Apple Silicon，需显式指定 `--mac --arm64` 目标。
3. 记录产物的文件名、版本号和大小。

---

## Step 3：上传 OSS 并通过 Lark 通知

1. 用 `licell` 把安装包上传到阿里云 OSS：
   - bucket：`opencoder`
   - region：`cn-shanghai`
   - 遵循 licell 的操作契约：先 `licell catalog --output json` 发现命令、再 `licell <command> --help --output json` 读取用法，最后带 `--output json` 执行，不要凭记忆猜命令和参数。
2. 拿到可下载的 URL（若命令返回的是内网/私有地址，需要生成可访问的下载链接）。
3. 通过 Lark CLI **点对点私聊**发送给 **房玉峰（大房）**，消息内容包含：
   - 下载链接与版本号；
   - 本轮主要改动点总结：上游合入了什么、fork 保留了什么、本轮下线了哪些重复实现（若有）。

---

## 完成标准

- `changes-by-cs.md` 与实际代码状态一致，且已 commit。
- typecheck / lint / 目标测试全绿。
- macOS arm64 安装包已上传 OSS 且链接可下载。
- 房玉峰（大房）已收到含链接和改动摘要的私聊消息。
