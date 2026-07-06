# 修复记录

## 改动

- `packages/desktop/build/entitlements.mac.plist` 增加 `com.apple.security.cs.disable-library-validation`
- `packages/desktop/build/entitlements.mac.inherit.plist` 增加同一 entitlement
- `packages/desktop/src/daemon/desktop-packaging.test.ts` 增加打包配置回归测试
- `docs/development.md` 记录本地 macOS packaged build 的签名/烟测注意事项

## 验证

- `npx vitest run packages/desktop/src/daemon/desktop-packaging.test.ts --bail=1`：通过，7 个用例
- `npm run format:files -- docs/development.md packages/desktop/build/entitlements.mac.plist packages/desktop/build/entitlements.mac.inherit.plist packages/desktop/src/daemon/desktop-packaging.test.ts`：通过
- `npm run lint`：通过
- `npm run typecheck`：通过
- 对 `/Applications/Paseo.app` 使用新增 entitlements 做本地 ad-hoc 重签名后，运行 `smokePackagedDesktopApp({ appPath: "/Applications/Paseo.app" })`：通过，桌面 app、CLI shim、terminal smoke 均成功

## 遗留风险

本地已安装的 `/Applications/Paseo.app` 被临时重签名用于验证。永久修复来自仓库中的 entitlements 改动，需要重新构建/安装新的桌面包。
