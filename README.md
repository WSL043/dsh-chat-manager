> [!NOTE]
> 1.5 面向 DSH 0.1.7-alpha.1，使用官方会话菜单扩展接口。归档搜索、取消归档和红色永久删除整合在设置页；兼容 Portable 提供侧边栏归档入口。旧内核请保留对应的旧版插件。
>
> 这是一个持续维护、可独立卸载的 DSH 插件。它补充归档浏览、聊天内容搜索、恢复与安全永久删除；不喜欢这套会话管理方式时，可以直接卸载，现有会话不会因此被删除。

<div align="center">

# DSH Chat Manager · 聊天与会话管理器

**在 DeepSeek Harness 原生侧边栏中搜索、恢复和安全清理会话。**

插件包名：`dsh-chat-manager`（原名 `dsh-native-session-manager`）。[Awesome DSH 收录](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/data/plugins/WSL043__dsh-chat-manager.yml) · [图片查看器插件](https://github.com/WSL043/dsh-image-viewer)

归档管理 · 聊天记录搜索 · 一键恢复 · 安全永久删除

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

| 归档可找回 | 聊天可搜索 | 删除更稳妥 |
| --- | --- | --- |
| 从侧边栏打开归档管理器，查看并恢复隐藏的会话 | 按会话名、工作区或用户与助手的聊天内容搜索归档 | 原生菜单保留二次确认；运行中的任务先安全停止，再删除本机会话记录 |

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-chat-manager/main/docs/assets/archive-manager.png" width="414" alt="DeepSeek Harness 原生归档会话管理器，支持聊天历史搜索、恢复和永久删除">
  <br><sub>DeepSeek Harness 0.1.1-rc.2 中的原生界面</sub>
</p>

## 安装

### 在官方插件页面安装（推荐）

1. 打开 DSH 的 **插件 → 添加插件**。
2. 在“包名或地址”中粘贴下面这一行，再点击安装：

```text
dsh-chat-manager@1.5.1
```

3. 查看安装结果；仅在页面要求时刷新或重启。安装失败时留在插件页查看错误，不必重复安装。

**1.5 适配 DSH 0.1.7-alpha.1。DSH 0.1.6-alpha.2 请使用 1.4.0-beta.3。** 不要把整条 `dsh plugin ...` 命令粘贴进包名框，也不要把仓库的 `main` 分支当作已验证发布包。

### 终端安装（可选）

在 DSH 或 Portable 的终端中执行：

```sh
dsh plugin --profile web add dsh-chat-manager@1.5.1
```

如果 DSH 正在运行，命令完成后保存工作并重新启动，以加载终端改动。旧内核请选择对应发布说明中已验证的插件版本。

交给 Agent 安装时使用固定版本的 [AGENTS.md](https://raw.githubusercontent.com/WSL043/dsh-chat-manager/v1.5.1/AGENTS.md)。

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
当前安装示例对应 DSH `0.1.7-alpha.1` 与插件 `1.5.1`；其他内核请查看对应发布说明。
<!-- /dsh-compatibility -->

归档浏览、恢复和内容搜索使用 DSH 的工作区注册表与会话查询能力；永久删除适用于 DSH 默认的逐会话
JSONL 存储。本版本保留官方工作区服务，仅扩展菜单与归档设置；卸载后撤去这些扩展。

## 更新与卸载

优先在官方 **插件** 页面查看已安装插件，使用该插件提供的更新或卸载操作；更新按钮未出现时，可在“添加插件”中填写已发布的目标 `包名@版本`。完成后按页面提示操作，不强制重启。以下是可选的终端方式。

更新时继续用 DSH 标准命令安装目标 npm 版本。v1.5.1 的命令是：

```sh
dsh plugin --profile web add dsh-chat-manager@1.5.1
```

卸载只移除这个插件的 bundle 层，不删除任何会话：

```sh
dsh plugin --profile web remove dsh-chat-manager
```

DSH-Portable 同样支持官方插件页和标准 `dsh plugin` 命令。终端改动完成后再重启正在运行的 DSH。

## 支持与许可证

可使用[问题反馈表单](https://github.com/WSL043/dsh-chat-manager/issues/new?template=bug-report.yml)
提交可复现问题，或使用[功能建议表单](https://github.com/WSL043/dsh-chat-manager/issues/new?template=feature-request.yml)
说明明确需求；安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

MIT。修改后的上游客户端及其许可说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

### 官方界面与 Portable

原生 DSH 保留官方归档页，侧边栏菜单提供红色「删除会话」。Portable 支持设置扩展时，归档页还提供搜索、取消归档和永久删除，且只有一个归档标签。关闭插件会恢复官方界面，不接管会话服务。
