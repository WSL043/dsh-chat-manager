<div align="center">

# DSH Chat Manager

**Manage DeepSeek Harness chat history from the native sidebar: search archives, restore sessions, and delete safely.**

[![Release](https://img.shields.io/github/v/release/WSL043/dsh-chat-manager?display_name=tag&style=flat-square)](https://github.com/WSL043/dsh-chat-manager/releases/latest)
[![Checks](https://img.shields.io/github/actions/workflow/status/WSL043/dsh-chat-manager/ci.yml?branch=main&label=checks&style=flat-square)](https://github.com/WSL043/dsh-chat-manager/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-chat-manager?style=flat-square)](https://www.npmjs.com/package/dsh-chat-manager)
[![total npm downloads](https://img.shields.io/npm/dt/dsh-chat-manager?style=flat-square&label=total%20downloads)](https://www.npmjs.com/package/dsh-chat-manager)
[![DSH](https://img.shields.io/badge/DSH-compatible-2f81f7?style=flat-square)](#compatibility)
[![License](https://img.shields.io/github/license/WSL043/dsh-chat-manager?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/WSL043/dsh-chat-manager?style=flat-square&label=stars)](https://github.com/WSL043/dsh-chat-manager/stargazers)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[中文](README.md) · [Install](#install) · [Use](#use) · [Safety](#safety-boundary)

</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-chat-manager/main/docs/assets/hero.en.png" alt='DeepSeek Harness chat history and archived session manager with search, restore, and safe permanent deletion'>
</p>

## Install

**DSH-Portable ships with this plugin preinstalled.** Enable or uninstall it on the Plugins page; other DSH users can install it below. ([About DSH-Portable](https://github.com/WSL043/DSH-Portable))

### Official plugin page (recommended)

1. Open **Plugins → Add plugin** in DSH.
2. Paste this line into **Package name or address**, then select Install:

```text
dsh-chat-manager@1.5.9
```

3. Follow the page result; refresh or restart only when requested.

See [Compatibility](#compatibility) for supported DSH cores.

### Terminal (optional)

For official DSH Desktop, register its bundled command through **Manage dsh Command…** and launch it once to initialize the profile; fully quit the app before using `desktop`. DSH-Portable 0.x and the Web profile use `web`:

```sh
dsh plugin --profile desktop add dsh-chat-manager@1.5.9
dsh plugin --profile web add dsh-chat-manager@1.5.9
```

For Agent installation, use the fixed-version [AGENTS.md](https://raw.githubusercontent.com/WSL043/dsh-chat-manager/v1.5.9/AGENTS.md).

## Use

### Browse, search, and restore archives

Select the archive icon in the sidebar header to browse archived sessions, search by name, workspace, or conversation, and select **Restore** to return a session to its original workspace. Search is limited to current user and assistant messages in archived sessions.

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-chat-manager/main/docs/assets/archive-manager.en.png" width="600" alt='DeepSeek Harness native archive page with search and restore'>
  <br><sub>Native DSH archive page</sub>
</p>

Stock DSH keeps its official archive page and adds the Delete permanently menu action. DSH-Portable's settings extension also adds archive search, restore, and permanent deletion; disabling the plugin restores the official views.

### Delete permanently

Click **⋯** beside a session in the sidebar and choose the red **Delete permanently**; check the session name in the dialog, then click **Confirm permanent deletion**—or cancel.

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-chat-manager/main/docs/assets/session-menu.en.png" width="450" alt="Delete permanently in the DSH sidebar session menu">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-chat-manager/main/docs/assets/confirm-delete.en.png" width="382" alt='DSH second confirmation dialog for permanent session deletion'>
  <br><sub>Permanent deletion cannot be undone; the dialog identifies the target session.</sub>
</p>

Running work is stopped and allowed to settle before deletion. On success, the session list updates without reloading the whole DSH page.

## Safety boundary

> [!WARNING]
> Permanent deletion cannot be undone. Check the session name and back up anything you need to keep.

The plugin validates and removes only the explicitly confirmed session directory within DSH's default per-session JSONL store and lifecycle boundary. DSH exposes no public deletion API; a second confirmation is mandatory, and cancelling sends no deletion request.

Deletion does not cover other sessions, plugin data, external attachments, caches, logs, backups, or cloud copies. Non-JSONL storage or hosts without a safe way to stop work are refused; operating-system cleanup failures are reported rather than treated as success.

This unofficial community plugin is not affiliated with or endorsed by DeepSeek. It is provided under the [MIT License](LICENSE), without warranty.

## Compatibility

<!-- dsh-compatibility -->
This release supports DeepSeek Harness `0.2.1-alpha.1`, `0.2.0-rc.2`, `0.2.0-rc.1`.
<!-- /dsh-compatibility -->

## Update and uninstall

Use the official **Plugins** page to update or uninstall. If no update action is offered, enter the target `package@version` under **Add plugin**. For terminal updates, install the target version; uninstall with:

```sh
dsh plugin --profile web remove dsh-chat-manager
```

DSH-Portable 0.x and Web use the `web` profile. For official DSH Desktop, fully quit the app and use the `desktop` profile as described above. Uninstall removes only this plugin and leaves existing sessions untouched.

## Support and license

Use the [bug report form](https://github.com/WSL043/dsh-chat-manager/issues/new?template=bug-report.yml) for reproducible problems or the [feature request form](https://github.com/WSL043/dsh-chat-manager/issues/new?template=feature-request.yml) for suggestions. Report security issues privately as described in [SECURITY.md](SECURITY.md).

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the modified upstream client and license notice.

## Quality

Each declared supported core is checked in the live interface.

[中文](README.md)
