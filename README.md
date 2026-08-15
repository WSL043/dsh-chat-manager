# DSH Session Delete

[English](README.en.md)

给 DeepSeek Harness 的原生会话菜单增加 **删除会话…**。删除前必须在弹窗中再次
确认；原有的归档选项仍然保留。

这是非官方社区插件，与 DeepSeek 官方无隶属或背书关系。

![DSH Session Delete 二次确认](docs/assets/confirm-delete.png)

## 能做什么

- 删除入口直接出现在原生会话操作菜单中；
- 使用明确的永久删除弹窗，不会单击菜单后立即删除；
- 正在运行或本次启动后已经打开的会话会被拒绝；
- 只删除经过会话 ID、存储根目录、真实路径和文件类型校验的独立 JSONL 会话目录；
- 请求必须是同源 JSON POST，并带有专用确认请求头。

## 准备 DSH

当前版本适配 DeepSeek Harness `0.1.0-rc.6` 的默认逐会话 JSONL 存储。插件采用
严格的上游界面标记；DSH 界面结构变化时构建会直接失败，不会静默生成错误补丁。

## 安装

### 交给 Agent

把下面的文档链接发给 Agent。文档包含安装、更新、卸载和验收边界：

https://raw.githubusercontent.com/WSL043/dsh-session-delete/main/AGENTS.md

### 已有 `dsh` 命令

```sh
dsh plugin --profile web add "@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.0/dsh-session-delete.tgz"
```

### Windows DSH-Portable

在 DSH-Portable 文件夹中执行：

```powershell
.\dsh.exe plugin --profile web add "@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.0/dsh-session-delete.tgz"
```

安装器会让这个包占用 DSH 原生的
`@deepseek-ai/dsh-client-ui-workspace` 依赖位，因此菜单是原生选项，而不是额外页面
或浏览器脚本。命令不会重启 DSH；安装完成后请手动重启。

## 使用

在侧边栏会话右侧打开操作菜单，选择 **删除会话…**，阅读永久删除提示后再点
**永久删除**。

如果会话正在运行或本次启动后已经打开，插件会拒绝删除。重启 DSH 后，不要先打开
目标会话，直接从侧边栏菜单删除。

## 更新与卸载

更新时运行新版本 Release 提供的同一条 `add` 命令。更新不会删除会话，也不会自动
重启 DSH。

普通 `web` profile 卸载：

```sh
dsh plugin --profile web remove @deepseek-ai/dsh-client-ui-workspace
```

DSH-Portable 使用 `.\dsh.exe` 执行同一组参数。卸载只移除插件，不会删除任何会话；
完成后手动重启 DSH。自定义 profile 如果原本显式固定了官方 workspace 包，应恢复原
依赖值，而不是直接移除；可交给 Agent 按 `AGENTS.md` 处理。

## 删除范围

删除的是默认 JSONL 后端中该会话独占的本地目录，包括主会话日志和同目录内的
session-owned 文件。操作不可撤销。

这不是“全盘隐私擦除”。其他插件、外部附件目录、索引、备份、同步副本或日志系统中的
数据不在本插件的删除范围内。非 JSONL 存储后端也不会被尝试删除。

## 为什么 DSH 原生只有归档

官方实现说明记录的是产品选择：原来的 Delete 只是视觉占位，后来明确改为非破坏性的
归档；会话日志和 workspace 记账都保留，所以无需危险样式或确认弹窗。与此同时，当前
JSONL 持久化接口没有会话删除契约。因此这更像是当前产品安全取舍与基础接口边界，
并不代表用户永远不应拥有删除能力。

参考：
[官方归档决策说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-07-31-session-archive-global-set.zh.md) ·
[JSONL 存储说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-persistence-jsonl/README.md)

## 支持

发现问题请提交 [GitHub Issue](https://github.com/WSL043/dsh-session-delete/issues)。
安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

MIT。修改后的上游客户端文件及其许可说明见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
