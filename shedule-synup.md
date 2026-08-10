# 定时任务：上游同步 → 三安装包构建 → 发布通知

本文件是一个可重复执行的 runbook，用于定时把原作者仓库的最新改动同步进本 fork，并同时分发 macOS Apple Silicon 桌面安装包、Web + Paseo Server 升级包和 Android APK。

## 前置事实

- Fork remote：`origin` -> `git@github.com:team-harness/paseo.git`
- **上游 remote：`upstream` -> `git@github.com:getpaseo/paseo.git`**
- 本 fork 的全部改动清单记录在 [changes-by-cs.md](changes-by-cs.md)，它同时也是同步时的决策依据。
- GitHub 网络需要走本机代理，执行 `git fetch` / `gh` 前先探测本机代理端口并配置。

> ⚠️ “同步上游最新改动”指的是 `upstream/main`（getpaseo/paseo），**不要**把 `origin` 当成上游。

---

## Step 1：同步上游改动

1. `git fetch upstream --prune`，对比 `changes-by-cs.md` 里记录的“最近同步基线”，确认是否真的有新提交。若没有新提交，记录一句“本轮无上游更新”，跳过 Step 2 / Step 3 / Step 4 / Step 5。
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

## Step 2：构建 macOS Apple Silicon 桌面安装包

前提：Step 1 确实合入了上游改动。若本轮无上游更新，跳过本步。

该 DMG **仅支持 Apple Silicon（arm64、M 系列芯片）的 Mac**，不能交给 Intel Mac、Linux 或 Windows 用户。非 arm64 用户使用 Step 3 的 Web + Paseo Server 包。

1. 本机发布固定使用 `Paseo Local Code Signing` 身份。签名材料放在
   `~/.paseo/signing/`，权限必须是目录 `0700`、文件 `0600`：
   - `Paseo-Local-Code-Signing.p12`
   - `Paseo-Local-Code-Signing.password`
   - `Paseo-Local-Code-Signing.cert.pem`

   P12 和密码不进 Git。构建前用
   `security verify-cert -c ~/.paseo/signing/Paseo-Local-Code-Signing.cert.pem -p codeSign`
   确认证书仍受本机信任。

   固定本地证书会稳定应用的 designated requirement，但不等同于 Apple Developer ID 公证。网络下载带 quarantine 的安装包仍可能被 Gatekeeper 拒绝；要让任意 Mac 无提示安装，使用 Developer ID 签名并公证。

2. 在仓库根目录重新构建当前提交的桌面产物：

   ```bash
   PASEO_SIGNING_DIR="$HOME/.paseo/signing"
   CSC_LINK="$PASEO_SIGNING_DIR/Paseo-Local-Code-Signing.p12" \
   CSC_KEY_PASSWORD="$(< "$PASEO_SIGNING_DIR/Paseo-Local-Code-Signing.password")" \
   CSC_NAME="Paseo Local Code Signing" \
   npm run build:desktop -- --mac --arm64 --publish never -c.mac.timestamp=none
   ```

   该脚本会重建 server 栈、导出 Expo web（`PASEO_WEB_PLATFORM=electron`）并调用 `electron-builder`。发布构建禁止启用 packaged desktop smoke，也禁止启动构建产物中的 Paseo 应用；同机运行的主 daemon 属于构建流程之外的生产进程。

3. **不要直接交付** `electron-builder` 刚生成的轻量 DMG。它在本机表现为约 130 MB 的 HFS 镜像，虽然 `hdiutil verify` 可通过，但用户的 Mac 不能可靠安装。必须生成与已验证历史安装包一致的标准布局：
   - 从 `packages/desktop/release/mac-arm64/Paseo.app` 复制本轮完整构建且已签名的应用；
   - 在 staging 目录放入 `Paseo.app` 及 `Applications -> /Applications` 快捷方式，再用 `hdiutil create -volname "Paseo <version>-arm64" -srcfolder <staging> -fs APFS -format UDZO -ov <output.dmg>` 封装。

   这样得到的是约 160 MB 的 APFS DMG。不要用旧版 `Paseo.app` 做底座，也不要在封装阶段改动已签名应用，否则会破坏固定签名身份。

4. 交付前必须全部验证：
   - `hdiutil verify <output.dmg>` 成功；
   - 只读挂载后，`Paseo.app/Contents/MacOS/Paseo` 为 `arm64`；
   - 只读挂载后，`Paseo.app/Contents/Info.plist` 的 `CFBundleShortVersionString` 必须等于当前提交的版本号；同时从 `app.asar` 提取 `node_modules/@getpaseo/server/package.json`，确认其 `version` 也相同。仅替换 `app-dist` 不足以升级桌面主进程和 daemon，禁止用旧版 `Paseo.app` 作为发布包底座；
   - 确认挂载包内 `app-dist/index.html` 指向本轮导出的 bundle，并能检索到本轮新增 UI 文案/代码；
   - `codesign --verify --deep --strict <Paseo.app>` 成功，`Authority` 为 `Paseo Local Code Signing`，designated requirement 绑定证书而不是 `cdhash`；
   - DMG 使用 APFS 镜像布局、大小与标准包同量级（约 160 MB），不能把约 130 MB 的轻量 HFS 包当成交付物；
   - 记录文件名、版本号、提交 SHA、大小和 SHA-256。

---

## Step 3：构建 Web + Paseo Server 升级包

前提：Step 1 确实合入了上游改动。若本轮无上游更新，跳过本步。

上游 GitHub Release 中的 `Paseo-<version>-x64.tar.gz` 是 Linux x64 Electron 桌面包，不是 Web + Server 包，不能拿它代替本步骤。

1. 在仓库根目录运行：

   ```bash
   npm run build:web-server-release
   ```

   产物为 `artifacts/releases/Paseo-<version>-web-server-<commit>.tar.gz`。脚本沿用官方 Docker 发布机制，依次 `npm pack` 以下 6 个 workspace：
   - `@getpaseo/highlight`
   - `@getpaseo/relay`
   - `@getpaseo/protocol`
   - `@getpaseo/client`
   - `@getpaseo/server`
   - `@getpaseo/cli`

   `@getpaseo/server` 的 `prepack` 会构建并嵌入匹配版本的浏览器 Web UI。必须同时交付 6 个包；只发布 server/CLI 会从 npm registry 拉取上游依赖，导致 fork 协议和功能丢失。

2. 归档根目录必须包含 `paseo-packs/*.tgz`、`manifest.json`、`paseo-source-revision`、`SHA256SUMS`、校验/安装脚本和 README。这个布局可以直接替换同事现有 Dockerfile 中拉 Git 源码、执行 `npm ci` 和 6 次 `npm pack` 的 `paseo-pack` 阶段。

3. 此包中的 workspace `.tgz` 与 CPU 架构无关，不携带本机 arm64 `node_modules`。目标电脑或 Docker runtime 使用 Node.js 22 和 npm，一次性安装 `paseo-packs/*.tgz`，由 npm 为目标架构下载外部依赖和原生模块。因此目标环境需要可访问 npm registry；该包不是离线依赖镜像。

4. 交付前必须全部验证：
   - `node --check scripts/build-web-server-release.mjs` 成功；
   - 解压到新建临时目录后，`node verify.mjs` 成功，且恰好包含上述 6 个 fork package；
   - server tgz 包含 `package/dist/server/web-ui/index.html`；
   - 使用临时 `NPM_CONFIG_PREFIX` 运行 `install.sh`，确认 6 个已安装 package 的版本都等于当前版本；
   - 不启动已安装的 server，不运行任何 `paseo daemon start`、`paseo daemon stop` 或 `paseo daemon restart`。`PASEO_HOME` 只隔离数据目录，不能保证 daemon 控制命令不会连接默认端口 `6767`；
   - 记录文件名、版本号、提交 SHA、大小和 SHA-256。

5. 构建前记录端口 `6767` 的监听 PID 并请求 `/api/health`；上传前再次执行同样的只读检查。PID 改变或健康检查失败时立即中止发布并报告，不尝试修复、重启或停止主 daemon。禁止在发布流程中使用会匹配 Paseo 进程的 `killall`、`pkill` 或宽泛 `kill`。需要端到端 daemon 冒烟测试时，必须在不承载用户会话的独立主机或容器中执行。

## Step 4：构建 Android APK

前提：Step 1 确实合入了上游改动。若本轮无上游更新，跳过本步。

该 APK 使用独立安装身份 `com.teamharness.paseo`，包含 `armeabi-v7a`、`arm64-v8a`、`x86` 和 `x86_64` 四种 ABI。固定 release keystore 位于 `packages/app/.secrets/`，不得提交、替换或重新生成；使用不同证书签名后，Android 将拒绝覆盖升级已有安装。

1. 构建前确认所有已跟踪改动都已提交，并记录端口 `6767` 的监听 PID 与 `/api/health`。逐项检查 `git status --short` 中的未跟踪文件：
   - 没有未跟踪文件时，运行 `npm run build:android-apk -- --offline`；
   - 只有确认不参与 APK 构建的文档等文件时，可运行 `npm run build:android-apk -- --offline --ignore-untracked`；
   - 存在未跟踪的应用源码、配置、依赖或其他构建输入时，禁止忽略，先提交或使用干净 checkout。
2. 默认命令会计算 native 配置指纹：覆盖 Expo prebuild 配置与生成工具版本、Android autolinking 结果、配置引用资源、自定义 config plugin 和已安装 React Native package 版本。指纹命中且 generated Android project 完整时复用 `packages/app/android`；指纹变化、元数据缺失或工程不完整时自动执行干净的 Expo prebuild。`--reuse-native-project` 仅作为人工确认工程仍有效后的强制覆盖，不用于常规定时发布。若离线构建因本轮依赖或工具链变化缺少缓存，先确认本机代理，再执行一次联网构建补齐 SDK、Gradle 与 Maven 缓存，随后必须重新以 `--offline` 构建成功。
3. 构建过程禁止启动模拟器、执行 `adb install`，也禁止运行任何 Paseo daemon start/stop/restart 命令。构建后再次检查端口 `6767` 的 PID 和健康状态，PID 改变或健康检查失败时立即中止发布。
4. 交付前必须全部验证：
   - 产物位于 `artifacts/android/Paseo-<version>-<commit>-android.apk`，版本和 commit 与本轮发布一致，文件名不得包含 `-dirty`；
   - `aapt dump badging` 显示 package name 为 `com.teamharness.paseo`，`versionName` 和 `versionCode` 等于 `packages/app/native-release-version.js` 对当前 package 版本的映射；例如 `0.3.0-beta.2` 映射为 `versionName 0.3.0`、`versionCode 3000`，完整 beta 版本保留在发布文件名中；
   - `apksigner verify --verbose --print-certs` 成功，签名证书与固定 keystore 一致；
   - APK 的 native libraries 同时包含 `armeabi-v7a`、`arm64-v8a`、`x86`、`x86_64`；
   - 记录文件名、版本号、提交 SHA、大小和 SHA-256，并确认 `.sha256` sidecar 内容匹配。

## Step 5：上传 OSS 并通过 Lark 通知

1. 用 `licell` 把三个安装包分别上传到阿里云 OSS：
   - bucket：`opencoder`
   - region：`cn-shanghai`
   - DMG 目标目录：`releases/paseo/<version>/<commit>/standard/`；只上传经验证的单个 DMG，避免把旧版本、`.DS_Store`、blockmap 或 unpacked app 一并发布。
   - Web + Server 目标目录：`releases/paseo/<version>/<commit>/web-server/`；只上传经验证的单个 tar.gz，不混入解压目录或中间 `.tgz`。
   - APK 目标目录：`releases/paseo/<version>/<commit>/android/`；只上传经验证的单个 APK，不上传旧 APK、`.sha256` sidecar、generated Android project 或 Gradle 中间产物。
   - 遵循 licell 的操作契约：先 `licell catalog --output json` 发现命令、再 `licell <command> --help --output json` 读取用法，最后带 `--output json` 执行，不要凭记忆猜命令和参数。
2. 拿到可下载的 URL 后，以 `curl -I --fail` 验证公网返回 `200` 和预期的 `Content-Length`。DMG 的 `Content-Type` 必须为 `application/x-apple-diskimage`；Web + Server 包必须为 gzip 类型；APK 必须为 `application/vnd.android.package-archive`。APK 下载链接固定使用 bucket 已绑定的 CNAME `https://openweb.bzy.ai/<object-key>`；阿里云会以 `ApkDownloadForbidden` 拒绝通过 `opencoder.oss-cn-shanghai.aliyuncs.com` 默认域名分发 APK。确认三个对象路径都与本轮 commit 一致后再发送。
3. APK 的 OSS 对象元数据和公网 URL 验证成功后，删除本轮本地 APK：
   - 精确删除 `artifacts/android/Paseo-<version>-<commit>-android.apk` 及对应 `.sha256` sidecar；
   - 精确删除 `packages/app/android/app/build/outputs/apk/release/app-release.apk`；
   - 禁止用 glob、`rm -rf artifacts/android` 或其他宽泛删除；不得删除 `packages/app/.secrets/`、Android SDK、Gradle/Maven 缓存或 generated Android project；
   - 上传或公网验证失败时不删除任何本轮 APK，保留用于重试。
4. 通过 Lark CLI 固定使用 **bot 身份**（`--as bot`），把发布通知发送到群会话 `oc_0f6042243cb5e249e558ac750aaf60cd`。执行命令时显式传入 `--chat-id oc_0f6042243cb5e249e558ac750aaf60cd` 和本轮唯一的 idempotency key；不要改用用户身份或点对点私聊。消息内容包含：
   - 三个下载链接与版本号；
   - DMG 明确标注“仅 macOS Apple Silicon（arm64 / M 系列芯片）”；
   - tar.gz 明确标注“Web + Paseo Server，供非 arm64 主机或浏览器用户升级”，并提示 Node.js 22、npm registry 网络和目标架构安装依赖的要求；
   - APK 明确标注 Android package id `com.teamharness.paseo`、包含四种 ABI，并提示只有使用同一 fork release keystore 签名的旧版本才能原地升级；
   - 本轮主要改动点总结：上游合入了什么、fork 保留了什么、本轮下线了哪些重复实现（若有）。

---

## 完成标准

- `changes-by-cs.md` 与实际代码状态一致，且已 commit。
- typecheck / lint / 目标测试全绿。
- macOS Apple Silicon DMG、Web + Paseo Server tar.gz 和 Android APK 都已上传 OSS 且链接可下载。
- OSS 验证成功后，本轮 APK、checksum sidecar 和 Gradle APK 输出已从本机删除；Android 签名与依赖缓存仍保留。
- 群会话 `oc_0f6042243cb5e249e558ac750aaf60cd` 已收到 bot 发送的三个链接、架构说明和改动摘要。
