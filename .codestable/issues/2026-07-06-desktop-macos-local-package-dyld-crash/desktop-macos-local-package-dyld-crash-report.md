# macOS 本地安装包启动时 dyld 崩溃

## 问题

当前 repo 构建并安装到 `/Applications/Paseo.app` 的 macOS 桌面包启动即崩溃。

崩溃报告显示 dyld 在加载 `@rpath/Electron Framework.framework/Electron Framework` 时拒绝：

- 主进程：`/Applications/Paseo.app/Contents/MacOS/Paseo`
- 被加载 framework：`/Applications/Paseo.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework`
- 失败原因：mapping process and mapped file have different Team IDs

## 环境

- macOS 26.5.1
- Apple Silicon arm64
- Paseo `0.1.104-beta.3`
- 本地构建安装包

## 影响

应用在 launch 阶段崩溃，主进程代码未开始运行。
