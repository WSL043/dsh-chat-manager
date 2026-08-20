<div align="center">

# DSH Session Delete

**Bring permanent deletion to the native DeepSeek Harness session menu.**

Second confirmation · Running work is stopped safely · No full-page reload

[![Release](https://img.shields.io/github/v/release/WSL043/dsh-session-delete?display_name=tag&style=flat-square)](https://github.com/WSL043/dsh-session-delete/releases/latest)
[![Checks](https://img.shields.io/github/actions/workflow/status/WSL043/dsh-session-delete/ci.yml?branch=main&label=checks&style=flat-square)](https://github.com/WSL043/dsh-session-delete/actions/workflows/ci.yml)
[![DSH](https://img.shields.io/badge/DSH-rc.6%E2%80%93rc.8-2f81f7?style=flat-square)](#compatibility)
[![License](https://img.shields.io/github/license/WSL043/dsh-session-delete?style=flat-square)](LICENSE)

[中文](README.md) · [Install](#install) · [Use](#use) · [Safety boundary](#safety-boundary)

</div>

<table>
  <tr>
    <td width="50%" align="center">
      <img src="docs/assets/confirm-delete.en.png" alt="English permanent deletion confirmation dialog">
      <br><sub>English UI</sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/assets/confirm-delete.png" alt="Chinese permanent deletion confirmation dialog">
      <br><sub>中文界面</sub>
    </td>
  </tr>
</table>

| Native | Safe | Smooth |
| --- | --- | --- |
| Lives in the native session actions menu and keeps Archive available | Requires a second confirmation and safely stops running work | Refreshes session state in place without reloading the whole DSH page |

## Install

### DSH

```sh
dsh plugin --profile web add "@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.5/dsh-session-delete.tgz"
```

### Windows DSH-Portable

Need DSH-Portable? Visit [WSL043/DSH-Portable](https://github.com/WSL043/DSH-Portable)
for downloads and usage instructions.

Run this inside the DSH-Portable folder:

```powershell
.\dsh.exe plugin --profile web add "@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.5/dsh-session-delete.tgz"
```

The command does not restart DSH. Restart it once after installation.

You can also give an Agent the
[version-pinned AGENTS.md](https://raw.githubusercontent.com/WSL043/dsh-session-delete/v0.1.5/AGENTS.md),
which defines the install, update, uninstall, and acceptance boundaries.

## Use

1. Open the actions menu beside the target session in the sidebar.
2. Choose the red **Delete session** action.
3. Check the session name, then select **Delete permanently**.

Sessions opened through the standard Web UI after the plugin becomes active do not need to be closed
manually. If work is still running, the plugin stops it through DSH's lifecycle capability, waits for
quiescence, tears down the session, and then removes its local record.

## Safety boundary

> [!WARNING]
> Permanent deletion cannot be undone. Confirm the target session and make a backup when needed.

- Only the target session-owned directory in the default JSONL backend is deleted;
- Other plugins, external attachments, caches, indexes, logs, backups, and synchronized copies are outside
  its scope, so this is not a secure-erasure tool;
- Non-JSONL storage and custom hosts without a safe stop capability are refused instead of force-deleted;
- If the operating system refuses cleanup, the plugin reports that deletion could not be confirmed rather
  than misreporting partial completion as success.

This is an unofficial community plugin and is not affiliated with or endorsed by DeepSeek. You are
responsible for having authority to delete the target data and for meeting applicable retention
requirements. The software is provided under the [MIT License](LICENSE), without warranty.

## Compatibility

This release supports the default per-session JSONL storage in DeepSeek Harness `0.1.0-rc.6`,
`0.1.0-rc.7`, and `0.1.0-rc.8`. The package is built from the rc.8 client and retains tested fallbacks
for rc.6 and rc.7 hosts.

Dependency automation discovers future DSH versions, but they are not automatically claimed as compatible.
A support release is published only after installation, startup, the native menu, second confirmation, and
disposable-session deletion all pass.

## Update and uninstall

To update, run the same `add` command from the new Release and restart DSH manually. Updating does not
delete sessions.

For a standard `web` profile:

```sh
dsh plugin --profile web remove @deepseek-ai/dsh-client-ui-workspace
```

Use `.\dsh.exe` with the same arguments for DSH-Portable. Uninstall removes only the plugin and never
deletes a session; restart DSH afterward. If a custom profile previously pinned the official workspace
package, restore that original dependency value.

<details>
<summary><strong>Messages you may see during installation</strong></summary>

- `dsh plugin ... list` is non-destructive to session data, but its first run may migrate a Portable
  profile, rebuild dependency links, or update a lockfile, so it is not strictly read-only on disk.
- This plugin contributes only a `dsh.client` injection. A missing `dsh.bundle` notice is expected and is
  not an installation failure.
- DSH supplies the runtime peers. They are marked optional here; assess warnings from other packages by
  package name.
- Every Release includes `dsh-session-delete.tgz.sha256` for SHA-256 verification.

</details>

<details>
<summary><strong>Why does upstream provide Archive only?</strong></summary>

The official implementation note records a product decision: the former Delete entry was only a visual
placeholder and was replaced with non-destructive archive. The current JSONL persistence seam also has no
session-deletion contract. This is best understood as the current safety choice and interface boundary,
not as a claim that users should never be able to delete local data.

[Official archive decision](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-07-31-session-archive-global-set.md)
· [JSONL storage documentation](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-persistence-jsonl/README.md)

</details>

## Support and license

Open a [GitHub Issue](https://github.com/WSL043/dsh-session-delete/issues) for ordinary problems. Report
security issues privately as described in [SECURITY.md](SECURITY.md).

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the modified upstream client and its license
notice.
