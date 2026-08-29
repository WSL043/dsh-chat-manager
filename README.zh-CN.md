<div align="center">

# DSH 聊天管理器

**在 DeepSeek Harness 原生侧边栏中搜索、恢复和安全清理会话。**

归档管理 · 聊天记录搜索 · 一键恢复 · 安全永久删除

[![Release](https://img.shields.io/github/v/release/WSL043/dsh-chat-manager?display_name=tag&style=flat-square)](https://github.com/WSL043/dsh-chat-manager/releases/latest)
[![Checks](https://img.shields.io/github/actions/workflow/status/WSL043/dsh-chat-manager/ci.yml?branch=main&label=checks&style=flat-square)](https://github.com/WSL043/dsh-chat-manager/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-chat-manager?style=flat-square)](https://www.npmjs.com/package/dsh-chat-manager)
[![npm 总下载量](https://img.shields.io/npm/dt/dsh-chat-manager?style=flat-square&label=%E6%80%BB%E4%B8%8B%E8%BD%BD%E9%87%8F)](https://www.npmjs.com/package/dsh-chat-manager)
[![DSH](https://img.shields.io/badge/DSH-compatible-2f81f7?style=flat-square)](#兼容性)
[![License](https://img.shields.io/github/license/WSL043/dsh-chat-manager?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/WSL043/dsh-chat-manager?style=flat-square&label=stars)](https://github.com/WSL043/dsh-chat-manager/stargazers)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[English](README.md) · [安装](#安装) · [使用](#使用) · [安全边界](#安全边界)

</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-chat-manager/main/docs/assets/hero.png" alt="DeepSeek Harness 聊天历史与归档会话管理器，支持搜索、恢复和安全永久删除">
</p>

| 归档可找回 | 聊天可搜索 | 删除更稳妥 |
| --- | --- | --- |
| 从侧边栏打开归档管理器，查看并恢复隐藏的会话 | 按会话名、工作区或用户与助手的聊天内容搜索归档 | 原生菜单保留二次确认；运行中的任务先安全停止，再删除本机会话记录 |

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-chat-manager/main/docs/assets/archive-manager.png" width="414" alt="DeepSeek Harness 原生归档会话管理器，支持聊天历史搜索、恢复和永久删除">
  <br><sub>DeepSeek Harness 0.1.1-rc.2 中的原生界面</sub>
</p>

## 安装

### DSH 标准命令

```sh
dsh plugin --profile web add dsh-chat-manager@1.2.1
```

安装完成后，保存工作并按 DSH 的正常方式重启一次，使新的 bundle 配置生效。

### 交给 Agent

请使用固定版本的 [AGENTS.md](https://raw.githubusercontent.com/WSL043/dsh-chat-manager/v1.2.1/AGENTS.md)，
其中写明了安装、更新、验收、卸载和安全边界。不要把 `main` 分支文档当作安装依据。

## 使用

### 管理归档

1. 点击侧边栏标题区域的归档图标，打开 **归档会话**。
2. 直接浏览全部归档，或按会话名、工作区和用户/助手聊天内容搜索。
3. 点击 **恢复** 让会话回到原来的工作区位置；需要彻底清理时，可从同一列表进入永久删除确认。

归档和恢复只改变 DSH 的隐藏状态，不删除聊天记录。搜索范围仅限已归档会话中的当前用户与助手消息，
不会把其他会话或插件数据混入结果。

### 永久删除

1. 打开侧边栏中目标会话右侧的原生操作菜单。
2. 选择红色的 **删除会话**。
3. 在确认弹窗中核对会话名称并再次确认 **永久删除**；也可以随时点击 **取消**。

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-chat-manager/main/docs/assets/confirm-delete.png" width="414" alt="DeepSeek Harness 安全永久删除会话的中文二次确认弹窗">
  <br><sub>永久删除无法撤销，确认弹窗会明确显示目标会话</sub>
</p>

插件生效后，删除逻辑复用 DSH 的生命周期和会话存储能力。正在运行的任务会先停止并等待
收敛，然后删除目标会话；成功后只更新会话列表，不重载整个 DSH 页面。

## 安全边界

> [!WARNING]
> 永久删除无法撤销。点下确认前，请核对会话名称；需要保留的内容请先另行备份。

本插件的责任范围是：在 DSH 默认逐会话 JSONL 存储和宿主生命周期边界内，验证并移除用户明确
确认的目标会话独占目录。DSH 当前没有公开会话删除 API；二次确认是强制步骤，取消不会发送删除请求。

以下内容不在本插件的删除范围内，也不保证被清理：

- 其他会话、其他插件数据、外部附件、缓存、索引、日志、备份和云端/同步副本；
- 非 JSONL 存储或宿主没有安全停止能力的会话；这类情况会拒绝强删并报告未完成；
- 操作系统、文件系统、宿主更新或第三方同步服务造成的额外副本。

如果系统拒绝清理，插件会报告无法确认删除成功，不会把部分完成误报为成功。删除前请确认
自己有权处理目标数据，并遵守适用的数据留存、审计和隐私要求。本项目是非官方社区插件，
与 DeepSeek 无隶属或背书关系；按 [MIT 许可证](LICENSE)提供，不附带担保。

## 兼容性

<!-- dsh-compatibility -->
支持软件包元数据中记录的最新版 DeepSeek Harness。
<!-- /dsh-compatibility -->

归档浏览、恢复和内容搜索使用 DSH 的工作区注册表与会话查询能力；永久删除适用于 DSH 默认的逐会话
JSONL 存储。安装后替换为带会话管理功能的原生工作区列表；卸载后恢复 DSH 原有列表。

## 更新与卸载

更新时继续用 DSH 标准命令安装目标 npm 版本。v1.2.1 的命令是：

```sh
dsh plugin --profile web add dsh-chat-manager@1.2.1
```

卸载只移除这个插件的 bundle 层，不删除任何会话：

```sh
dsh plugin --profile web remove dsh-chat-manager
```

DSH-Portable 同样使用标准的 `dsh plugin` 命令。完成安装、更新或卸载后，按 DSH 的正常方式重启，
使配置重新组合。

## 支持与许可证

可使用[问题反馈表单](https://github.com/WSL043/dsh-chat-manager/issues/new?template=bug-report.yml)
提交可复现问题，或使用[功能建议表单](https://github.com/WSL043/dsh-chat-manager/issues/new?template=feature-request.yml)
说明明确需求；安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

MIT。修改后的上游客户端及其许可说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
