# DSH Session Delete

[中文](README.md)

Adds **Delete session…** to the native DeepSeek Harness session menu. Deletion
always requires a second confirmation in a modal, while the existing archive
action remains available.

This is an unofficial community plugin and is not affiliated with or endorsed
by DeepSeek.

![DSH Session Delete confirmation dialog](docs/assets/confirm-delete.png)

## Important: risks and responsibility

> **Make your own backup first. After you select Delete permanently, there is
> no recycle bin, undo action, or official recovery workflow.**

- The operator must have authority to dispose of the target session and must
  independently verify the target, backup requirements, and any organizational
  or legal retention obligations. The authors and maintainers do not decide
  whether a particular session should be deleted for you.
- This release supports only the default per-session JSONL storage in DeepSeek
  Harness `0.1.0-rc.6` and replaces the native workspace package dependency
  slot. DSH upgrades, custom profiles, or another plugin replacing the same
  slot may be incompatible. Uninstall or revalidate before upgrading.
- The plugin deletes only the verified session-owned target directory. It does
  not promise to remove indexes, caches, attachments, logs, backups,
  synchronized copies, or data stored by other plugins, and must not be treated
  as a complete privacy-erasure or compliance-destruction tool.
- The operator assumes the risk of selecting the wrong target, failing to keep
  a backup, compatibility changes, interruption, configuration conflicts, data
  loss, service disruption, and other loss caused by using or being unable to
  use the plugin.
- The software is provided “as is” under the [MIT License](LICENSE), without
  express or implied warranties. To the maximum extent permitted by applicable
  law, the authors and maintainers are not liable for damages arising from use
  of or inability to use the software. Liability that cannot legally be
  excluded or limited remains unaffected.

## What it does

- Places deletion in the native session actions menu;
- Requires an explicit permanent-deletion confirmation;
- Refuses sessions that are running or have been opened since DSH started;
- Deletes only a standalone JSONL session directory whose identity, storage
  root, real path, and file type have been verified;
- Accepts only a same-origin JSON POST with a dedicated confirmation header.

## Prepare DSH

This release supports the default per-session JSONL storage in DeepSeek Harness
`0.1.0-rc.6`. Its build uses strict upstream UI markers, so an incompatible DSH
UI change fails the build instead of silently producing a malformed patch.

## Install

### Let an Agent install it

Send this guide to your Agent. It includes install, update, uninstall, and
verification boundaries:

https://raw.githubusercontent.com/WSL043/dsh-session-delete/main/AGENTS.md

### Existing `dsh` command

```sh
dsh plugin --profile web add "@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.0/dsh-session-delete.tgz"
```

### Windows DSH-Portable

Run this inside the DSH-Portable folder:

```powershell
.\dsh.exe plugin --profile web add "@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.0/dsh-session-delete.tgz"
```

The package occupies DSH's native
`@deepseek-ai/dsh-client-ui-workspace` dependency slot. This is what makes the
new action part of the native menu rather than a separate page or browser
userscript. The command does not restart DSH; restart it manually afterward.

## Use

Open a session's actions menu in the sidebar, choose **Delete session…**, read
the warning, and select **Delete permanently**.

If the session is running or has already been opened during this DSH process,
deletion is refused. Restart DSH, do not open the target session, and delete it
directly from the sidebar.

## Update and uninstall

To update, run the same `add` command from the new fixed Release. Updating does
not delete sessions or restart DSH.

For a standard `web` profile:

```sh
dsh plugin --profile web remove @deepseek-ai/dsh-client-ui-workspace
```

Use `.\dsh.exe` with the same arguments for DSH-Portable. Uninstall removes
only the plugin and does not delete any session. Restart DSH manually. If a
custom profile explicitly pinned the official workspace package before
installation, restore that original dependency instead of removing it; an Agent
can follow `AGENTS.md`.

## Deletion scope

The plugin deletes the session-owned directory in the default JSONL backend,
including the main transcript and session-owned files stored in that directory.
The operation cannot be undone.

This is not a system-wide privacy erase. Data held by other plugins, external
attachment directories, indexes, backups, synchronized copies, or logging
systems is outside this plugin's scope. Non-JSONL storage backends are refused.

## Why upstream provides archive instead

The official implementation note records a product choice: the former Delete
entry was only a visual placeholder and was replaced with non-destructive
archive. Session logs and workspace accounting stay intact, so the native
archive action does not need destructive styling or confirmation. The current
JSONL persistence seam also has no session-deletion contract. This is best
understood as the current product safety choice and interface boundary, not as a
claim that users should never be able to delete local data.

References:
[official archive decision](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-07-31-session-archive-global-set.md) ·
[JSONL storage documentation](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-persistence-jsonl/README.md)

## Support

Open a [GitHub Issue](https://github.com/WSL043/dsh-session-delete/issues) for
ordinary problems. Report security issues privately as described in
[SECURITY.md](SECURITY.md).

## License

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the modified
upstream client and its license notice.
