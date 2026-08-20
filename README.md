# DSH Session Delete

[English](README.en.md)

给 DeepSeek Harness 的原生会话菜单增加 **删除会话**。删除前必须在弹窗中再次
确认；原有的归档选项仍然保留。

这是非官方社区插件，与 DeepSeek 官方无隶属或背书关系。

![DSH Session Delete 二次确认](docs/assets/confirm-delete.png)

## 删除前请注意

> **永久删除无法撤销。请确认目标会话，并按需提前备份。**

当前版本支持 DeepSeek Harness `0.1.0-rc.6`、`0.1.0-rc.7` 和 `0.1.0-rc.8` 的默认逐会话
JSONL 存储。它删除的是目标会话独占目录，并不清理其他插件、缓存、索引、备份或同步
副本，因此不是安全擦除工具。你需要自行确认有权删除目标会话，并遵守适用的数据留存
要求。

本项目是非官方社区插件。DSH 升级或替换同一 workspace 依赖位的其他插件可能导致
不兼容；升级后请重新验证。软件按 [MIT 许可证](LICENSE)提供，不附带担保。

## 能做什么

- 删除入口直接出现在原生会话操作菜单中，并使用 DSH 原生红色危险态；
- 使用明确的永久删除弹窗，不会单击菜单后立即删除；
- 标准 Web 界面在插件生效后打开的会话可直接删除；正在运行的任务会先安全停止，再由
  DSH 有序摘载会话；
- 删除成功后原地刷新会话与 workspace 状态，不重载整个 DSH 页面；
- 删除期间阻止同一会话重新打开，并在校验原始路径无连接、文件身份和 JSONL 布局后，
  先原子摘走目标目录再清理；
- 请求必须是同源 JSON POST，并带有专用确认请求头。

## 准备 DSH

当前版本适配 DeepSeek Harness `0.1.0-rc.6`、`0.1.0-rc.7` 和 `0.1.0-rc.8` 的默认
逐会话 JSONL 存储。发布包基于 rc.8 客户端构建，并为 rc.6/rc.7 宿主保留经过测试的
兼容回退。

后续 DSH 版本不会被自动宣称为兼容。依赖更新机器人会发现新版本并触发 CI；只有在
严格上游标记、安装、启动、原生菜单、二次确认和一次性测试会话删除全部通过后，才会
发布新的支持版本。这样可自动发现更新，但不会把未经验证的破坏性功能交给用户。

## 安装

### 交给 Agent

把下面的文档链接发给 Agent。文档包含安装、更新、卸载和验收边界：

https://raw.githubusercontent.com/WSL043/dsh-session-delete/v0.1.5/AGENTS.md

### 已有 `dsh` 命令

```sh
dsh plugin --profile web add "@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.5/dsh-session-delete.tgz"
```

### Windows DSH-Portable

在 DSH-Portable 文件夹中执行：

```powershell
.\dsh.exe plugin --profile web add "@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.5/dsh-session-delete.tgz"
```

安装器会让这个包占用 DSH 原生的
`@deepseek-ai/dsh-client-ui-workspace` 依赖位，因此菜单是原生选项，而不是额外页面
或浏览器脚本。命令不会重启 DSH；安装完成后请手动重启。

Release 同时提供 `dsh-session-delete.tgz.sha256`。下载两个文件后，可用
`Get-FileHash .\dsh-session-delete.tgz -Algorithm SHA256`（Windows）或
`sha256sum -c dsh-session-delete.tgz.sha256`（Linux/macOS）校验 SHA-256。

## 使用

在侧边栏会话右侧打开操作菜单，选择红色的 **删除会话**，阅读永久删除提示后再点
**永久删除**。

标准 Web 界面在插件生效后打开的会话无需手动关闭。确认永久删除后，如果目标会话正在
运行，插件会先调用 DSH 的生命周期句柄停止并等待任务收敛，再摘载会话并删除本地记录。
若自定义宿主直接创建会话却不提供可安全停止的生命周期能力，插件会拒绝删除，不会强删。

## 安装提示与验收

- `dsh plugin ... list` 对会话数据无破坏性，但并非严格的文件系统只读命令；首次运行
  可能迁移 Portable profile、重建依赖链接或更新锁文件。
- 本插件只有 `dsh.client` 客户端注入，不提供配置补丁层；因此缺少 `dsh.bundle` 的提示
  是预期信息，不代表安装失败，也不应为消除提示而添加空 bundle。
- DSH 宿主负责提供运行时 peer。自 v0.1.1 起已把这些 peer 标为 optional，以避免把宿主注入
  误报成插件缺包；如果 profile 中其他插件仍有 peer 告警，应按包名分别判断。

从源码安装依赖并执行 `pnpm exec playwright install chromium` 后，可对一个明确指定的
现有会话运行非破坏性验收：

```sh
pnpm smoke:ui -- --url http://127.0.0.1:14171 --session "Exact session title"
```

脚本只验证 **归档会话**、**删除会话**、二次确认弹窗和取消逻辑；它不会点击
**永久删除**，也不会启动、停止或重启 DSH。

若要验收删除成功后的无闪屏路径，可在 DSH 自带的隔离 fixture 中拦截删除请求：

```sh
pnpm smoke:ui -- --url "http://127.0.0.1:14171/?fixture" --session "Fixture 历史会话" --simulate-delete-success
```

该模式只允许用于带 `?fixture` 的页面；它会模拟成功响应并确认主页面没有重载，不会把
请求发送到 Host，也不会删除真实会话。

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

这不是安全擦除。其他插件、外部附件目录、索引、备份、同步副本或日志系统中的
数据不在本插件的删除范围内。非 JSONL 存储后端也不会被尝试删除。

若操作系统在目录已经从 DSH 摘载后拒绝清理剩余文件，插件会明确报告“不能确认永久删除
成功”，不会误报为完整成功或声称没有文件发生变化。

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
