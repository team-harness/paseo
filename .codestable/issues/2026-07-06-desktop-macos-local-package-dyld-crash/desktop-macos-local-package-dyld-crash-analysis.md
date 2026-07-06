# 根因分析

## 证据

`codesign -dv --verbose=4` 检查已安装 app 后发现：

- `/Applications/Paseo.app` 为 ad-hoc 签名，`TeamIdentifier=not set`
- `Electron Framework.framework` 也为 ad-hoc 签名，`TeamIdentifier=not set`
- app entitlements 只有 `allow-jit`、`allow-unsigned-executable-memory`、`audio-input`
- `electron-builder.yml` 开启了 `mac.hardenedRuntime: true`

## 根因

本地 macOS 构建没有 Apple Developer ID 证书时会产生 ad-hoc 签名包。Paseo 同时启用了 hardened runtime，但 entitlements 缺少 `com.apple.security.cs.disable-library-validation`。

在这种组合下，dyld/library validation 会在主程序加载 Electron 嵌入 framework 时进行签名身份校验，并可能因为 Team ID 不一致/不可用而在 launch 阶段直接 abort。

## 修复方案

在主 entitlements 和继承 entitlements 中保留 `com.apple.security.cs.disable-library-validation`，允许 hardened runtime app 加载 Electron 随包 framework。补桌面打包测试，防止后续误删。
