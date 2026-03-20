# GitLab Auto Deploy - 构建指南

## 项目概述

GitLab Auto Deploy 是一个 Electron 桌面应用，用于自动化 GitLab Web 项目的部署流程。

## 技术栈

- **框架**: Electron 33 + Vue 3
- **构建工具**: electron-vite 2 + electron-builder 24
- **包管理器**: pnpm
- **UI**: Element Plus

## 开发命令

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建应用
pnpm build

# 预览构建结果
pnpm preview
```

## 打包命令

```bash
# macOS (DMG + ZIP)
pnpm build:mac

# Windows (NSIS 安装包 + 便携版)
pnpm build:win

# Linux (AppImage + DEB + RPM)
pnpm build:linux

# 所有平台
pnpm build:all
```

## 代码签名配置

### macOS

设置以下环境变量启用代码签名和公证：

```bash
export APPLE_ID="your-apple-id@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # 从 appleid.apple.com 生成
export APPLE_TEAM_ID="XXXXXXXXXX"  # 从 developer.apple.com 获取
export CSC_LINK="/path/to/certificate.p12"  # Developer ID Application 证书
export CSC_KEY_PASSWORD="certificate-password"
```

### Windows

设置以下环境变量启用代码签名：

```powershell
$env:CSC_LINK = "C:\path\to\certificate.pfx"
$env:CSC_KEY_PASSWORD = "certificate-password"
```

## 自动更新配置

应用配置为使用 GitHub Releases 进行自动更新。在 `build/electron-builder.yml` 中修改：

```yaml
publish:
  - provider: github
    owner: your-username
    repo: your-repo-name
```

## 输出目录

构建产物位于 `dist/` 目录：

- **macOS**: `GitLab Auto Deploy-{version}-{arch}.dmg`, `GitLab Auto Deploy-{version}-{arch}.zip`
- **Windows**: `GitLab Auto Deploy-Setup-{version}-{arch}.exe`
- **Linux**: `GitLab Auto Deploy-{version}-{arch}.AppImage`, `.deb`, `.rpm`

## 文件结构

```
gitlab-auto-deploy/
├── build/                    # 构建资源
│   ├── electron-builder.yml  # electron-builder 配置
│   ├── entitlements.mac.plist
│   ├── icon.icns            # macOS 图标
│   ├── icon.ico             # Windows 图标
│   ├── icons/               # Linux 图标
│   ├── installer.nsh        # Windows NSIS 自定义脚本
│   └── notarize.js          # macOS 公证脚本
├── resources/                # 应用资源
│   └── icon.png             # 源图标 (1024x1024)
├── src/
│   ├── main/                # 主进程代码
│   ├── preload/             # 预加载脚本
│   └── renderer/            # 渲染进程 (Vue UI)
└── out/                     # 构建输出
```

## 功能特性

- GitLab 项目分支监控
- 自动构建触发
- SSH/SFTP 部署
- 后台守护模式
- 部署队列管理
- 日志记录和导出