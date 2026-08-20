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

### Windows 安装助手（推荐）

打开 PowerShell，只复制这一行：

```powershell
$u='https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.6'; $p="$env:TEMP\dsh-session-delete-setup.ps1"; curl.exe -fL "$u/dsh-session-delete-setup.ps1" -o $p; curl.exe -fL "$u/dsh-session-delete-setup.ps1.sha256" -o "$p.sha256"; if ($LASTEXITCODE -ne 0) { throw '下载失败' }; $want=((Get-Content "$p.sha256" -Raw) -split '\s+')[0]; if ((Get-FileHash $p -Algorithm SHA256).Hash -ne $want) { throw '校验失败' }; powershell.exe -NoProfile -ExecutionPolicy Bypass -File $p
```

安装助手会先选择中文或 English，再自动寻找普通 DSH 和
[DSH-Portable](https://github.com/WSL043/DSH-Portable)。检测到多个安装时会列出路径供选择；
检测到旧版本时会自动更新。它会记住目标 DSH 和安装前的 workspace 依赖，卸载时恢复原值。

不需要管理员权限，也不会安装系统 Node.js/pnpm、结束任务或擅自重启 DSH。完成后手动重启一次。

<details>
<summary><strong>执行前手动校验安装助手</strong></summary>

入口命令已经校验安装助手。安装助手还会校验其下载的管理器与插件包。

</details>

### 交给 Agent

把 [AGENTS.md 固定版本链接](https://raw.githubusercontent.com/WSL043/dsh-session-delete/v0.1.6/AGENTS.md)
发给 Agent；其中包含安装、更新、卸载、回滚和验收边界。

### macOS、Linux 或已有 `dsh` 命令

```sh
dsh plugin --profile web add "@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.6/dsh-session-delete.tgz"
```

这条通用命令不会安装管理助手；如果 profile 原本显式固定了官方 workspace 包，卸载前应
记录并恢复原值。安装完成后手动重启 DSH。

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

Windows 安装助手用户以后只需要：

| 操作 | 命令 |
| --- | --- |
| 更新 | `dsh-session-delete update` |
| 卸载 | `dsh-session-delete uninstall` |

更新会先下载并校验最新 Release 安装器；卸载会恢复首次安装前记录的 workspace 依赖。
两项操作都不会删除会话或自动重启 DSH。

使用通用命令安装时，可用新 Release 的同一条 `add` 命令更新。仅当安装前没有显式
workspace 依赖时，才直接执行：

普通 `web` profile 卸载：

```sh
dsh plugin --profile web remove @deepseek-ai/dsh-client-ui-workspace
```

若原本存在显式 workspace 依赖，请用 `add` 恢复记录的原值，不要直接 remove。完成后
手动重启 DSH。

<details>
<summary><strong>安装时可能看到的提示</strong></summary>

- `dsh plugin ... list` 不会破坏会话数据，但首次运行可能迁移 Portable profile、重建依赖
  链接或更新锁文件，因此不能严格视为文件系统只读。
- 本插件只有 `dsh.client` 客户端注入；缺少 `dsh.bundle` 的提示是预期信息，不代表失败。
- DSH 宿主负责提供运行时 peer。本插件已将这些 peer 标为 optional；若其他包仍有警告，
  应按包名分别判断。
- Release 同时提供安装助手、管理器和插件包各自的 `.sha256`，入口命令会先做 SHA-256 校验再执行。

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
