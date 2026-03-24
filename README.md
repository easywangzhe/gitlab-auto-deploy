# GitLab Auto Deploy

一个基于 Electron + Vue 3 的桌面应用程序，用于自动化 GitLab 项目的部署流程。

## 功能特性

- **自动部署**: 监听 GitLab 项目分支的更新，自动触发部署流程
- **多种触发方式**: 支持 GitLab MR 合并和直接 Push 到分支两种触发方式
- **多项目管理**: 支持配置多个 GitLab 项目，每个项目独立配置部署参数
- **服务器管理**: 配置部署目标服务器，支持 SSH 密钥认证
- **构建队列**: 部署任务队列管理，支持取消、重试、回滚操作
- **实时日志**: 查看部署过程的详细日志
- **系统通知**: 部署成功/失败时发送桌面通知

## 安装

### 下载安装包

从 [Releases](https://github.com/easywangzhe/gitlab-auto-deploy/releases) 页面下载对应平台的安装包：

- **macOS**: 下载 `.dmg` 文件
- **Windows**: 下载 `.exe` 安装包

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/easywangzhe/gitlab-auto-deploy.git
cd gitlab-auto-deploy

# 安装依赖
pnpm install

# 开发模式运行
pnpm dev

# 构建应用
pnpm build:mac    # macOS
pnpm build:win    # Windows
pnpm build:linux  # Linux
pnpm build:all    # 所有平台
```

## 使用指南

### 1. 配置 GitLab 连接

1. 进入 **GitLab 连接** 页面
2. 点击 **添加连接**
3. 填写连接信息：
   - 连接名称：自定义名称（如"公司 GitLab"）
   - API URL：GitLab 服务器地址（如 `https://gitlab.com`）
   - Access Token：GitLab 个人访问令牌
4. 点击 **测试连接** 验证配置
5. 保存配置

> 支持添加多个 GitLab 连接，可以同时管理多个 GitLab 服务器的项目。

### 2. 配置部署服务器

1. 进入 **服务器管理** 页面
2. 点击 **添加服务器**
3. 填写服务器信息：
   - 名称：服务器别名
   - 主机地址：服务器 IP 或域名
   - SSH 端口：默认 22
   - 用户名：SSH 登录用户
   - 认证方式：密码或 SSH 密钥
4. 测试 SSH 连接
5. 保存配置

> 支持添加多个部署服务器，每个项目可以部署到不同的服务器。

### 3. 添加项目

1. 进入 **项目管理** 页面
2. 点击 **添加项目**
3. 填写项目信息：
   - 项目名称：自定义名称
   - GitLab 连接：选择已配置的 GitLab 连接
   - GitLab 路径：项目路径（如 `group/project`）
   - GitLab ID：项目的数字 ID
   - 服务器：选择部署目标服务器
   - 分支：监听的分支（如 `main`、`dev`）
   - 部署路径：服务器上的目标路径
   - 构建命令：自定义构建命令（如 `npm run build:prod`，留空自动检测）
   - 输出目录：构建产物目录（如 `dist`）
   - 健康检查 URL：可选，部署后验证
   - 自动部署：开启后守护进程会自动监控并部署
4. 保存项目

### 4. 启用守护进程

1. 进入 **设置** 页面
2. 在 **守护进程** 区域：
   - 打开 **启用守护进程** 开关
   - 配置轮询间隔（默认 1 分钟）

守护进程启动后会自动监听配置了自动部署的项目，当检测到分支有新的提交或 MR 合并时，自动触发部署流程。

### 5. 回滚部署

1. 进入项目详情页
2. 点击 **回滚** 按钮
3. 从提交历史中选择要回滚到的版本
4. 确认回滚

回滚会重新部署所选版本的代码，无需服务器备份文件。

## 配置文件

应用数据存储在以下位置：

- **macOS**: `~/Library/Application Support/gitlab-auto-deploy/`
- **Windows**: `%APPDATA%\gitlab-auto-deploy\`
- **Linux**: `~/.config/gitlab-auto-deploy/`

### 目录结构

```
gitlab-auto-deploy/
├── data/
│   ├── projects/          # 项目配置
│   ├── deployments/       # 部署记录
│   ├── settings.json      # 应用设置
│   ├── queue-state.json   # 队列状态
│   └── last-check-times.json  # 守护进程检查时间缓存
├── logs/
│   └── main.log          # 应用日志
└── workspace/            # 构建工作目录
```

## 部署流程

1. **克隆代码**: 从 GitLab 克隆项目到本地工作目录
2. **安装依赖**: 自动检测包管理器 (npm/yarn/pnpm) 并安装依赖
3. **构建项目**: 执行配置的构建命令
4. **创建备份**: 在服务器上创建当前版本的备份
5. **上传文件**: 通过 SSH/SFTP 上传构建产物
6. **健康检查**: 可选的健康检查验证
7. **完成通知**: 发送桌面通知

## 开发

### 技术栈

- **Electron**: 跨平台桌面应用框架
- **Vue 3**: 前端框架
- **TypeScript**: 类型安全
- **Pinia**: 状态管理
- **Element Plus**: UI 组件库
- **electron-vite**: 构建工具
- **electron-builder**: 打包工具

### 项目结构

```
gitlab-auto-deploy/
├── build/                # 构建资源
├── resources/            # 应用资源
├── src/
│   ├── main/            # 主进程代码
│   │   ├── services/    # 后端服务
│   │   └── utils/       # 工具函数
│   ├── preload/         # 预加载脚本
│   ├── renderer/        # 渲染进程 (Vue 应用)
│   │   ├── components/  # Vue 组件
│   │   ├── views/       # 页面视图
│   │   └── stores/      # Pinia stores
│   └── shared/          # 共享类型定义
├── package.json
└── electron-builder.yml # 打包配置
```

### 开发命令

```bash
# 开发模式
pnpm dev

# 类型检查
pnpm tsc --noEmit

# 代码格式化
pnpm format

# 代码检查
pnpm lint

# 构建但不打包
pnpm build

# 打包应用
pnpm build:mac
pnpm build:win
```

## 许可证

[MIT](LICENSE)

## 贡献

欢迎提交 Issue 和 Pull Request！

## 作者

wangzhe
