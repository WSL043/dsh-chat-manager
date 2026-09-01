> [!NOTE]
> This is an actively maintained, independently removable DSH plugin. It adds archive browsing, conversation-content search, restore, and safe permanent deletion. If this session workflow is not for you, uninstalling the plugin leaves existing sessions untouched.

<div align="center">

# DSH Chat Manager

**Manage DeepSeek Harness chat history from the native sidebar: search archives, restore sessions, and delete safely.**

Archive manager · Conversation search · One-click restore · Safe permanent deletion

[![Release](https://img.shields.io/github/v/release/WSL043/dsh-chat-manager?display_name=tag&style=flat-square)](https://github.com/WSL043/dsh-chat-manager/releases/latest)
[![Checks](https://img.shields.io/github/actions/workflow/status/WSL043/dsh-chat-manager/ci.yml?branch=main&label=checks&style=flat-square)](https://github.com/WSL043/dsh-chat-manager/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-chat-manager?style=flat-square)](https://www.npmjs.com/package/dsh-chat-manager)
[![total npm downloads](https://img.shields.io/npm/dt/dsh-chat-manager?style=flat-square&label=total%20downloads)](https://www.npmjs.com/package/dsh-chat-manager)
[![DSH](https://img.shields.io/badge/DSH-compatible-2f81f7?style=flat-square)](#compatibility)
[![License](https://img.shields.io/github/license/WSL043/dsh-chat-manager?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/WSL043/dsh-chat-manager?style=flat-square&label=stars)](https://github.com/WSL043/dsh-chat-manager/stargazers)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[中文](README.md) · [Install](#install) · [Use](#use) · [Safety boundary](#safety-boundary)

</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-chat-manager/main/docs/assets/hero.en.png" alt="DeepSeek Harness chat history and archived session manager with search, restore, and safe permanent deletion">
</p>

| Recover archives | Search conversations | Delete safely |
| --- | --- | --- |
| Open the archive manager from the sidebar and restore hidden sessions | Search archived names, workspaces, and user/assistant conversation content | Keep native second confirmation; running work is stopped safely before local records are removed |

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-chat-manager/main/docs/assets/archive-manager.en.png" width="414" alt="Native DeepSeek Harness archived conversation manager with history search, restore, and permanent deletion">
  <br><sub>Native interface on DeepSeek Harness 0.1.1-rc.2</sub>
</p>

## Install

### Standard DSH command

```sh
dsh plugin --profile web add dsh-chat-manager@1.2.2
```

When the command finishes, save your work and restart DSH once through its normal workflow so the new
bundle configuration becomes active.

### Agent installation

Use the fixed-version [AGENTS.md](https://raw.githubusercontent.com/WSL043/dsh-chat-manager/v1.2.2/AGENTS.md).
It defines installation, update, acceptance, uninstall, and safety boundaries. Do not use the `main`
branch document as an installation contract.

## Use

### Manage archives

1. Select the archive icon in the sidebar header to open **Archived sessions**.
2. Browse every archive or search by session name, workspace, and user/assistant conversation content.
3. Select **Restore** to return a session to its original workspace position. To remove it completely,
   start the permanent-delete confirmation from the same list.

Archive and restore only change DSH's hidden state; they do not delete conversation history. Content search
is limited to current user and assistant messages inside archived sessions.

### Delete permanently

1. Open the native actions menu beside the target session in the sidebar.
2. Choose the red **Delete session** action.
3. Check the session name and select **Delete permanently** in the confirmation dialog, or select
   **Cancel** to leave it unchanged.

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-chat-manager/main/docs/assets/confirm-delete.en.png" width="414" alt="DeepSeek Harness safe permanent session deletion confirmation dialog">
  <br><sub>Permanent deletion cannot be undone; the dialog identifies the target session.</sub>
</p>

Once active, the plugin reuses DSH lifecycle and session-storage capabilities. If work is still running,
it is stopped and allowed to settle before the target session is deleted. The session list then
updates in place without reloading the whole DSH page.

## Safety boundary

> [!WARNING]
> Permanent deletion cannot be undone. Check the session name before confirming and make a separate backup when needed.

The plugin is responsible for validating and removing only the explicitly confirmed session's dedicated
directory within DSH's default per-session JSONL store and host lifecycle boundary. DSH currently exposes
no public session-deletion API. The second confirmation is mandatory; cancelling sends no deletion request.

The following are outside the plugin's deletion scope and are not guaranteed to be removed:

- Other sessions, other plugin data, external attachments, caches, indexes, logs, backups, or cloud/sync copies;
- Non-JSONL storage or hosts without a safe stop capability; these are refused instead of force-deleted;
- Additional copies created by the operating system, filesystem, host updates, or third-party sync services.

If the operating system refuses cleanup, the plugin reports that deletion could not be confirmed rather
than misreporting partial completion as success. You are responsible for having authority to delete the
target data and for meeting applicable retention, audit, and privacy requirements. This is an unofficial
community plugin, not affiliated with or endorsed by DeepSeek. It is provided under the [MIT License](LICENSE),
without warranty.

## Compatibility

<!-- dsh-compatibility -->
Supports the latest DeepSeek Harness release recorded in the package metadata.
<!-- /dsh-compatibility -->

Archive browsing, restore, and content search use DSH's workspace registry and session-query capabilities.
Permanent deletion supports DSH's default per-session JSONL storage. Installing replaces the native workspace
list with the session-management version; uninstalling restores DSH's original list.

## Update and uninstall

Install the target npm version with the same standard DSH command. For v1.2.2:

```sh
dsh plugin --profile web add dsh-chat-manager@1.2.2
```

Uninstall removes only this plugin's bundle layer and never deletes sessions:

```sh
dsh plugin --profile web remove dsh-chat-manager
```

DSH-Portable exposes the same standard `dsh plugin` commands. Restart DSH through its normal workflow
after installing, updating, or uninstalling so the configuration is recomposed.

## Support and license

Use the [bug report form](https://github.com/WSL043/dsh-chat-manager/issues/new?template=bug-report.yml)
for reproducible problems or the [feature request form](https://github.com/WSL043/dsh-chat-manager/issues/new?template=feature-request.yml)
for focused improvements. Report security issues privately as described in [SECURITY.md](SECURITY.md).

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the modified upstream client and its license
notice.
