<div align="center">

# DSH Session Delete

**Bring permanent session deletion to the native DeepSeek Harness menu.**

Native dark menu · Second confirmation · Safe stop for running work · In-place list update

[![Release](https://img.shields.io/github/v/release/WSL043/dsh-session-delete?display_name=tag&style=flat-square)](https://github.com/WSL043/dsh-session-delete/releases/latest)
[![Checks](https://img.shields.io/github/actions/workflow/status/WSL043/dsh-session-delete/ci.yml?branch=main&label=checks&style=flat-square)](https://github.com/WSL043/dsh-session-delete/actions/workflows/ci.yml)
[![DSH](https://img.shields.io/badge/DSH-rc.6%E2%80%93rc.8-2f81f7?style=flat-square)](#compatibility)
[![License](https://img.shields.io/github/license/WSL043/dsh-session-delete?style=flat-square)](LICENSE)

[中文](README.md) · [Install](#install) · [Use](#use) · [Safety boundary](#safety-boundary)

</div>

<p align="center">
  <img src="docs/assets/hero.en.png" alt="Red Delete session action in the native DeepSeek Harness dark-mode session menu">
</p>

| Native | Safe | Smooth |
| --- | --- | --- |
| The action lives in the native session menu and keeps Archive available | A second confirmation is required; running work is stopped safely | The list updates in place without reloading the whole DSH page |

## Install

### Windows quick install (recommended)

Open PowerShell and paste one line:

```powershell
irm 'https://github.com/WSL043/dsh-session-delete/releases/download/v1.0.1/install.ps1' | iex
```

The helper checks only the current directory, PATH, and a few common DSH-Portable locations, then calls
the official DSH `plugin add` command once. It does not scan disks recursively, install a package manager,
snapshot profiles, create a resident command, or download the plugin twice. It supports regular DSH and
[DSH-Portable](https://github.com/WSL043/DSH-Portable).

For a Portable copy in a custom location, provide its executable explicitly without a disk scan:

```powershell
& ([scriptblock]::Create((irm 'https://github.com/WSL043/dsh-session-delete/releases/download/v1.0.1/install.ps1'))) -DshPath 'D:\DSH-Portable\dsh.exe'
```

### Official CLI (macOS, Linux, or direct review)

```sh
dsh plugin --profile web add "dsh-native-session-delete@https://github.com/WSL043/dsh-session-delete/releases/download/v1.0.1/dsh-native-session-delete.tgz"
```

The helper and direct command use the same standard bundle mechanism. The helper is only a Windows entry
point; DSH still owns the installation transaction.

When the command finishes, save your work and restart DSH once through its normal workflow so the new
bundle configuration becomes active.

### Agent installation

Use the fixed-version [AGENTS.md](https://raw.githubusercontent.com/WSL043/dsh-session-delete/v1.0.1/AGENTS.md).
It defines installation, update, acceptance, uninstall, and safety boundaries. Do not use the `main`
branch document as an installation contract.

## Use

1. Open the native actions menu beside the target session in the sidebar.
2. Choose the red **Delete session…** action.
3. Check the session name and select **Delete permanently** in the confirmation dialog, or select
   **Cancel** to leave it unchanged.

<p align="center">
  <img src="docs/assets/confirm-delete.en.png" width="560" alt="English dark-mode permanent deletion confirmation dialog">
  <br><sub>Permanent deletion cannot be undone; the dialog identifies the target session.</sub>
</p>

Once active, the plugin reuses DSH lifecycle and session-storage capabilities. If work is still running,
it is stopped safely and allowed to settle before the target session is deleted. The session list then
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

v1.0.1 targets the default per-session JSONL storage in DeepSeek Harness `0.1.0-rc.6`, `0.1.0-rc.7`,
and `0.1.0-rc.8`. It uses a standard `dsh.bundle` profile layer that replaces the official workspace
row with the uniquely identified native client `dsh-native-session-delete`; uninstalling restores the
official workspace row.

Future DSH updates are not automatically claimed as compatible. A new support release is published only
after rebuilding and passing installation, startup, native-menu, second-confirmation, cancellation,
no-reload, and disposable-session deletion acceptance checks.

## Update and uninstall

Update by rerunning the quick installer or using the new release in the same `add` command. For v1.0.1:

```sh
dsh plugin --profile web add "dsh-native-session-delete@https://github.com/WSL043/dsh-session-delete/releases/download/v1.0.1/dsh-native-session-delete.tgz"
```

Uninstall removes only this plugin's bundle layer and never deletes sessions:

```sh
dsh plugin --profile web remove dsh-native-session-delete
```

For DSH-Portable, use the corresponding `.\dsh.exe plugin --profile web add ...` or
`.\dsh.exe plugin --profile web remove dsh-native-session-delete`. Restart DSH through its normal
workflow after installing, updating, or uninstalling so the configuration is recomposed.

## Support and license

Open a [GitHub Issue](https://github.com/WSL043/dsh-session-delete/issues) for ordinary problems. Report
security issues privately as described in [SECURITY.md](SECURITY.md).

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the modified upstream client and its license
notice.
