<div align="center">

# DSH Session Delete

**把“删除会话”带回 DeepSeek Harness 原生菜单。**

再次确认 · 运行中安全停止 · 删除后无整页闪烁

[![Release](https://img.shields.io/github/v/release/WSL043/dsh-session-delete?display_name=tag&style=flat-square)](https://github.com/WSL043/dsh-session-delete/releases/latest)
[![Checks](https://img.shields.io/github/actions/workflow/status/WSL043/dsh-session-delete/ci.yml?branch=main&label=checks&style=flat-square)](https://github.com/WSL043/dsh-session-delete/actions/workflows/ci.yml)
[![DSH](https://img.shields.io/badge/DSH-rc.6%E2%80%93rc.8-2f81f7?style=flat-square)](#兼容性)
[![License](https://img.shields.io/github/license/WSL043/dsh-session-delete?style=flat-square)](LICENSE)

[English](README.en.md) · [安装](#安装) · [使用](#使用) · [安全边界](#安全边界)

</div>

<table>
  <tr>
    <td width="50%" align="center">
      <img src="docs/assets/confirm-delete.png" alt="中文永久删除二次确认弹窗">
      <br><sub>中文界面</sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/assets/confirm-delete.en.png" alt="English permanent deletion confirmation dialog">
      <br><sub>English UI</sub>
    </td>
  </tr>
</table>

| 原生 | 安全 | 顺滑 |
| --- | --- | --- |
| 删除入口就在会话原生操作菜单中，并保留原有归档 | 永久删除前必须再次确认；正在运行的任务会先安全停止 | 成功后原地刷新会话列表，不重载整个 DSH 页面 |

## 安装

### DSH

```sh
dsh plugin --profile web add "@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.5/dsh-session-delete.tgz"
```

### Windows DSH-Portable

在 DSH-Portable 文件夹中执行：

```powershell
.\dsh.exe plugin --profile web add "@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.5/dsh-session-delete.tgz"
```

命令不会自动重启 DSH。安装完成后手动重启一次即可。

也可以把 [AGENTS.md 固定版本链接](https://raw.githubusercontent.com/WSL043/dsh-session-delete/v0.1.5/AGENTS.md)
交给 Agent；其中包含安装、更新、卸载和验收边界。

## 使用

1. 打开侧边栏中目标会话右侧的操作菜单。
2. 选择红色的 **删除会话**。
3. 核对会话名称，再点 **永久删除**。

插件生效后通过标准 Web 界面打开的会话无需手动关闭。如果任务仍在运行，插件会先调用
DSH 生命周期能力停止任务并等待收敛，再摘载会话并删除本地记录。

## 安全边界

> [!WARNING]
> 永久删除无法撤销。请先确认目标会话，并按需备份。

- 仅删除默认 JSONL 后端中目标会话独占的本地目录；
- 不清理其他插件、外部附件、缓存、索引、日志、备份或同步副本，因此不是安全擦除工具；
- 非 JSONL 存储或缺少安全停止能力的自定义宿主会被拒绝，不会强删；
- 如果操作系统拒绝清理，插件会明确报告无法确认删除成功，不会把部分完成误报为成功。

本项目是非官方社区插件，与 DeepSeek 官方无隶属或背书关系。使用者需确认自己有权删除
目标数据并遵守适用的数据留存要求。软件按 [MIT 许可证](LICENSE)提供，不附带担保。

## 兼容性

当前版本适配 DeepSeek Harness `0.1.0-rc.6`、`0.1.0-rc.7` 和 `0.1.0-rc.8` 的默认
逐会话 JSONL 存储。发布包基于 rc.8 客户端构建，并保留经过测试的 rc.6/rc.7 回退。

后续 DSH 版本会由依赖更新流程自动发现，但不会被自动宣称兼容。只有安装、启动、原生
菜单、二次确认和一次性测试会话删除全部通过后，才会发布新的支持版本。

## 更新与卸载

更新时运行新 Release 中的同一条 `add` 命令，然后手动重启 DSH。更新不会删除会话。

普通 `web` profile 卸载：

```sh
dsh plugin --profile web remove @deepseek-ai/dsh-client-ui-workspace
```

DSH-Portable 使用 `.\dsh.exe` 执行同一组参数。卸载只移除插件，不会删除任何会话；
完成后手动重启。自定义 profile 若原本固定了官方 workspace 包，应恢复原依赖值。

<details>
<summary><strong>安装时可能看到的提示</strong></summary>

- `dsh plugin ... list` 不会破坏会话数据，但首次运行可能迁移 Portable profile、重建依赖
  链接或更新锁文件，因此不能严格视为文件系统只读。
- 本插件只有 `dsh.client` 客户端注入；缺少 `dsh.bundle` 的提示是预期信息，不代表失败。
- DSH 宿主负责提供运行时 peer。本插件已将这些 peer 标为 optional；若其他包仍有警告，
  应按包名分别判断。
- Release 同时提供 `dsh-session-delete.tgz.sha256`，可用于校验下载包的 SHA-256。

</details>

<details>
<summary><strong>为什么 DSH 原生只有归档？</strong></summary>

官方实现说明记录的是产品选择：原来的 Delete 只是视觉占位，后来被明确改为非破坏性的
归档；当前 JSONL 持久化接口也没有会话删除契约。这更像是现阶段的安全取舍与接口边界，
不代表用户永远不应拥有删除本地数据的能力。

[官方归档决策说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-07-31-session-archive-global-set.zh.md)
· [JSONL 存储说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-persistence-jsonl/README.md)

</details>

## 支持与许可证

普通问题请提交 [GitHub Issue](https://github.com/WSL043/dsh-session-delete/issues)；安全问题请按
[SECURITY.md](SECURITY.md) 私下报告。

MIT。修改后的上游客户端文件及其许可说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
