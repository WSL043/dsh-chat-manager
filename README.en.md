# DSH Session Delete

[中文](README.md)

Adds **Delete session…** to the native DeepSeek Harness session menu. Deletion
always requires a second confirmation in a modal, while the existing archive
action remains available.

This is an unofficial community plugin and is not affiliated with or endorsed
by DeepSeek.

![DSH Session Delete confirmation dialog](docs/assets/confirm-delete.en.png)

## Before deleting

> **Permanent deletion cannot be undone. Confirm the target session and make a
> backup first when needed.**

This release supports only the default per-session JSONL storage in DeepSeek
Harness `0.1.0-rc.6`. It deletes the target session-owned directory; data held
by other plugins, caches, indexes, backups, or synchronized copies is outside
its scope, so this is not a secure-erasure tool. You are responsible for having
authority to delete the target session and for meeting applicable retention
requirements.

This is an unofficial community plugin. DSH upgrades or another plugin using
the same workspace dependency slot may be incompatible; revalidate after an
upgrade. The software is provided under the [MIT License](LICENSE), without
warranty.

## What it does

- Places deletion in the native session actions menu;
- Requires an explicit permanent-deletion confirmation;
- Deletes opened sessions directly; running work is stopped safely before DSH
  tears down the session in lifecycle order;
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
dsh plugin --profile web add "@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.1/dsh-session-delete.tgz"
```

### Windows DSH-Portable

Run this inside the DSH-Portable folder:

```powershell
.\dsh.exe plugin --profile web add "@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.1/dsh-session-delete.tgz"
```

The package occupies DSH's native
`@deepseek-ai/dsh-client-ui-workspace` dependency slot. This is what makes the
new action part of the native menu rather than a separate page or browser
userscript. The command does not restart DSH; restart it manually afterward.

Each Release also provides `dsh-session-delete.tgz.sha256`. Download both files
and verify the SHA-256 with `Get-FileHash .\dsh-session-delete.tgz -Algorithm
SHA256` on Windows or `sha256sum -c dsh-session-delete.tgz.sha256` on
Linux/macOS.

## Use

Open a session's actions menu in the sidebar, choose **Delete session…**, read
the warning, and select **Delete permanently**.

Opened sessions do not need to be closed manually. After confirmation, running
work is stopped safely through DSH's lifecycle handle; the plugin waits for
quiescence, tears down the session, and then removes its local record.

## Installation notes and acceptance check

- `dsh plugin ... list` is non-destructive to session data, but it is not
  strictly read-only on disk. Its first run may migrate a Portable profile,
  rebuild dependency links, or update a lockfile.
- This is a `dsh.client` injection and does not contribute a configuration patch
  layer. A missing `dsh.bundle` notice is expected, is not an installation
  failure, and should not be silenced with an empty bundle.
- DSH supplies the runtime peers. v0.1.1 marks them optional so host injection
  is not misreported as a plugin defect. If other profile packages still emit
  peer warnings, assess them by package name.

From a source checkout, install dependencies and run `pnpm exec playwright
install chromium`, then check one explicitly named existing session without
deleting it:

```sh
pnpm smoke:ui -- --url http://127.0.0.1:14171 --session "Exact session title"
```

The script verifies **Archive session**, **Delete session…**, the second
confirmation, and cancellation. It never clicks **Delete permanently** and
does not start, stop, or restart DSH.

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

This is not secure erasure. Data held by other plugins, external
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
