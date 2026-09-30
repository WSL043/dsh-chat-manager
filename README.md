<div align="center">

# DSH Chat Manager · 聊天与会话管理器

**在 DeepSeek Harness 原生侧边栏中搜索、恢复和安全清理会话。**

[![Release](https://img.shields.io/github/v/release/WSL043/dsh-chat-manager?display_name=tag&style=flat-square)](https://github.com/WSL043/dsh-chat-manager/releases/latest)
[![Checks](https://img.shields.io/github/actions/workflow/status/WSL043/dsh-chat-manager/ci.yml?branch=main&label=checks&style=flat-square)](https://github.com/WSL043/dsh-chat-manager/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-chat-manager?style=flat-square)](https://www.npmjs.com/package/dsh-chat-manager)
[![npm 总下载量](https://img.shields.io/npm/dt/dsh-chat-manager?style=flat-square&label=%E6%80%BB%E4%B8%8B%E8%BD%BD%E9%87%8F)](https://www.npmjs.com/package/dsh-chat-manager)
[![DSH](https://img.shields.io/badge/DSH-compatible-2f81f7?style=flat-square)](#兼容性)
[![License](https://img.shields.io/github/license/WSL043/dsh-chat-manager?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/WSL043/dsh-chat-manager?style=flat-square&label=stars)](https://github.com/WSL043/dsh-chat-manager/stargazers)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[English](README.en.md) · [安装](#安装) · [使用](#使用) · [安全边界](#安全边界)

</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-chat-manager/main/docs/assets/hero.png" alt="DeepSeek Harness 聊天历史与归档会话管理器，支持搜索、恢复和安全永久删除">
</p>

## 安装

**DSH-Portable 已预装本插件**，可在插件页启用或卸载；其他 DSH 用户按下方安装。([了解 DSH-Portable](https://github.com/WSL043/DSH-Portable))

### 在官方插件页面安装（推荐）

1. 打开 DSH 的 **插件 → 添加插件**。
2. 在“包名或地址”中粘贴并安装：

```text
dsh-chat-manager@1.5.4
```

3. 按页面结果操作；仅在页面要求时刷新或重启。

**版本 1.5.4 支持 DSH 内核 `0.1.7-alpha.1`、`0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.0-rc.2`。**

### 终端安装（可选）

官方 DSH Desktop 需先通过应用的 **Manage dsh Command…** 注册自带命令并启动一次以初始化 profile；完全退出应用后使用 `desktop`。DSH-Portable 0.x 和网页版使用 `web`：

```sh
dsh plugin --profile desktop add dsh-chat-manager@1.5.4
dsh plugin --profile web add dsh-chat-manager@1.5.4
```

交给 Agent 安装时使用固定版本的 [AGENTS.md](https://raw.githubusercontent.com/WSL043/dsh-chat-manager/v1.5.4/AGENTS.md)。

## 使用

### 归档、搜索与恢复

点击侧边栏标题处的归档图标，可浏览归档并按会话名、工作区或聊天内容搜索；点击 **恢复** 将会话放回原工作区。搜索仅涉及已归档会话中的当前用户和助手消息。

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-chat-manager/main/docs/assets/archive-manager.png" width="414" alt='DeepSeek Harness 原生归档界面，支持搜索与恢复'>
  <br><sub>DSH 原生归档界面</sub>
</p>

原生 DSH 保留官方归档页并提供删除菜单。DSH-Portable 的设置扩展还会在归档页提供搜索、恢复和永久删除；停用插件可恢复官方界面。

### 永久删除

从目标会话旁的原生菜单选择红色 **删除会话**，核对名称后在弹窗中再次确认 **永久删除**，或取消。

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-chat-manager/main/docs/assets/confirm-delete.png" width="414" alt='DSH 永久删除会话的二次确认弹窗'>
  <br><sub>永久删除无法撤销；确认弹窗会明确显示目标会话</sub>
</p>

正在运行的任务会先停止并等待收敛，再删除目标会话；成功后只更新会话列表，不重载整个 DSH 页面。

## 安全边界

> [!WARNING]
> 永久删除无法撤销。确认前请核对会话名称，并备份需要保留的内容。

插件只在 DSH 默认逐会话 JSONL 存储与宿主生命周期边界内验证并移除用户确认的目标会话目录。DSH 尚无公开删除 API；二次确认是强制步骤，取消不会发送删除请求。

删除范围不包括其他会话、插件数据、外部附件、缓存、日志、备份或云端副本。非 JSONL 存储或宿主无法安全停止任务时会拒绝强删；系统拒绝清理时也会如实报告未能确认成功。

本项目是非官方社区插件，与 DeepSeek 无隶属或背书关系；按 [MIT 许可证](LICENSE)提供，不附带担保。

## 兼容性

<!-- dsh-compatibility -->
当前版本支持 DeepSeek Harness `0.1.7-alpha.1`、`0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.0-rc.2`。
<!-- /dsh-compatibility -->

## 更新与卸载

在官方 **插件** 页面更新或卸载；无更新操作时，在“添加插件”中填写目标 `包名@版本`。终端更新继续安装目标版本，卸载命令如下：

```sh
dsh plugin --profile web remove dsh-chat-manager
```

DSH-Portable 0.x 和网页版使用 `web` profile；官方 DSH Desktop 按上方说明完全退出应用并使用 `desktop` profile。卸载只移除本插件，不会删除现有会话。

## 反馈与许可证

可通过[问题反馈表单](https://github.com/WSL043/dsh-chat-manager/issues/new?template=bug-report.yml)报告可复现问题，或使用[功能建议表单](https://github.com/WSL043/dsh-chat-manager/issues/new?template=feature-request.yml)提交需求；安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

MIT。第三方客户端修改及其许可说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 质量

每个声明支持的内核均完成真实界面核验。
