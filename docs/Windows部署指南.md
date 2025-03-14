# Cherry Studio Windows 部署指南

本指南将帮助您在 Windows 系统上部署和运行 Cherry Studio，一款支持多个大语言模型（LLM）服务商的桌面客户端。

## 目录

- [系统要求](#系统要求)
- [安装方法](#安装方法)
  - [方法一：直接下载安装](#方法一直接下载安装)
  - [方法二：从源代码构建](#方法二从源代码构建)
- [基本配置](#基本配置)
- [常见问题](#常见问题)

## 系统要求

- Windows 10 或 Windows 11 操作系统
- 至少 4GB RAM（推荐 8GB 或更高）
- 至少 500MB 可用磁盘空间
- 稳定的网络连接（使用在线 AI 服务时需要）

## 安装方法

### 方法一：直接下载安装

这是最简单的安装方法，适合大多数用户：

1. 访问 [Cherry Studio 官方发布页面](https://github.com/kangfenmao/cherry-studio/releases)
2. 下载最新版本的 Windows 安装包（文件名通常为 `Cherry-Studio-Setup-x.x.x.exe`，其中 x.x.x 为版本号）
3. 下载完成后，双击安装文件运行
4. 按照安装向导的指示完成安装
5. 安装完成后，从 Windows 开始菜单或桌面快捷方式启动 Cherry Studio

### 方法二：从源代码构建

如果您是开发者或希望从源代码构建应用，请按照以下步骤操作：

#### 前置条件

1. 安装 [Node.js](https://nodejs.org/)（推荐使用 LTS 版本）
2. 安装 [Git](https://git-scm.com/download/win)
3. 安装 [Yarn](https://yarnpkg.com/) 包管理器（本项目使用 Yarn v4.6.0）

#### 克隆代码并构建

1. 打开命令提示符或 PowerShell，执行以下命令克隆代码库：

```bash
git clone https://github.com/kangfenmao/cherry-studio.git
cd cherry-studio
```

2. 安装项目依赖：

```bash
yarn
```

3. 构建 Windows 应用程序：

```bash
yarn build:win
```

或者，如果您需要专门针对 64 位系统构建：

```bash
yarn build:win:x64
```

4. 构建完成后，可执行文件将位于 `dist` 目录中

## 基本配置

首次启动 Cherry Studio 后，您需要进行一些基本配置：

1. **选择服务商并配置 API**：
   - 在设置面板中选择您想要使用的 AI 服务商（如 OpenAI、Gemini、Anthropic 等）
   - 输入您从相应服务商获取的 API 密钥
   - 如果使用代理，请正确配置代理设置

2. **选择或创建 AI 助手**：
   - Cherry Studio 内置了 300+ 预配置 AI 助手
   - 您也可以创建自定义助手，以满足特定需求

3. **配置界面**：
   - 选择明亮或暗黑主题
   - 调整字体大小和窗口透明度
   - 设置快捷键以提高使用效率

## 常见问题

### 应用无法启动

- 确保您的 Windows 系统已更新到最新版本
- 检查是否安装了所有必要的 Windows 更新和组件
- 尝试以管理员身份运行应用

### 连接 AI 服务失败

- 验证您的 API 密钥是否正确输入
- 检查网络连接是否稳定
- 如果使用代理，确保代理设置正确

### 本地模型设置

对于需要使用 Ollama 或 LM Studio 等本地模型的用户：

1. 请先安装并配置相应的本地模型软件
2. 在 Cherry Studio 中，添加本地模型的访问端点
3. 按照界面提示完成配置

### 数据备份

Cherry Studio 支持使用 WebDAV 进行数据备份：

1. 在设置中找到备份选项
2. 配置 WebDAV 服务器信息
3. 设置自动备份频率或手动执行备份

## 更多资源

- [Cherry Studio 官方文档](https://github.com/kangfenmao/cherry-studio)
- [Telegram 群组](https://t.me/CherryStudioAI)
- [Discord 社区](https://discord.gg/wez8HtpxqQ)
- [QQ 群(472019156)](https://qm.qq.com/q/CbZiBWwCXu)

如果您在部署过程中遇到任何问题，欢迎加入上述社区群组寻求帮助。

---

希望这份指南能帮助您成功部署 Cherry Studio。祝您使用愉快！
