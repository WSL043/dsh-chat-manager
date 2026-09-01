# DSH Chat Manager

已有的、可独立卸载的 DeepSeek Harness 会话管理插件。当前版本收缩为只补充官方界面暂时缺少的“恢复已归档会话”入口。

## 功能

- 在“设置 → 插件 → 会话恢复”中列出官方归档集合。
- 恢复所选会话，同时保留会话日志、工作区顺序和其他设置。
- 使用官方会话与工作区快照，不替换官方工作区界面。

本插件不会搜索会话正文、不会永久删除会话，也不会接管官方的搜索、分叉或归档功能。

## 安装与卸载

```powershell
pnpm add dsh-chat-manager@beta
```

它可以由 DSH-Portable 在首次全新环境中作为默认插件安装。之后卸载或删除会被视为用户选择，Portable 更新不会自动装回。

## 兼容性

已面向 DeepSeek Harness `0.1.1-rc.2`、`0.1.2-alpha.2` 和 `0.1.2-alpha.3` 的插件契约构建。最终兼容性以对应 Portable 版本的安装验收为准。

English documentation: [README.en.md](README.en.md)
