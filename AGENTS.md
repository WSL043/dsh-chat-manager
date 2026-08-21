# Agent installation guide

Use this guide when a user explicitly asks an Agent to install, update, verify,
or remove `dsh-native-session-delete` in a selected DeepSeek Harness profile.

## Safety and responsibility boundary

- Confirm the target DSH installation and profile. Use `web` only when it is the user's target.
- Use the fixed v1.0.6 package below; never substitute a moving branch or an unreviewed source.
- Do not print session contents, full profile files, transcript paths, credentials, or other private data.
- Do not start, stop, or restart DSH without explicit permission.
- Preserve all sessions, unrelated plugins, and user-owned profile changes.
- Never delete a session as an installation test unless the user explicitly selects a disposable session
  and confirms the destructive test.
- Prefer one durable user installation over disposable copies under `LocalAppData\Temp`. If more than one
  durable DSH installation remains, ask which installation is the target before changing it.

Permanent deletion is irreversible. The Agent must not claim that this plugin provides secure erasure:
external attachments, caches, logs, backups, cloud copies, and non-JSONL stores are outside its scope.
The user is responsible for authority to delete the selected data and for applicable retention or privacy
requirements. A cancelled confirmation is the safe default and must not send a delete request.

## Fixed package and standard bundle

The v1.0.6 package is a standard DSH bundle with a `dsh.bundle` profile patch. Its exact package spec is:

```text
dsh-native-session-delete@1.0.6
```

The bundle disables the official workspace row while installed and inserts a uniquely identified native
workspace row. Removing `dsh-native-session-delete` removes that layer, allowing DSH to restore the official
workspace row. Do not install the tarball under `@deepseek-ai/dsh-client-ui-workspace`; that old aliasing
approach is not the v1.0.6 contract.

## Detect the target DSH

Use read-only filesystem checks to locate the requested target. On Windows:

```powershell
Get-Command dsh -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath . -Filter dsh.exe -File -ErrorAction SilentlyContinue
```

For DSH-Portable, a valid root normally contains `dsh.exe`, `runtime\node\node.exe`, and
`app\node_modules\@deepseek-ai\dsh\lib\bin.js`. Missing system Node.js or pnpm is normal for
DSH-Portable; do not install either globally just for this plugin.

`dsh plugin ... list` is not strictly read-only. Its first invocation may initialize or migrate a Portable
profile, rebuild dependency links, or update profile package-manager metadata. It is non-destructive to
session contents, but an Agent must not describe it as a filesystem read-only check. If attribution matters,
record the selected profile's relevant metadata before invoking it, without printing secrets.

## Install or update

With an existing `dsh` command, run exactly:

```sh
dsh plugin --profile web add dsh-native-session-delete@1.0.6
```

With DSH-Portable, run from its root:

```powershell
.\dsh.exe plugin --profile web add dsh-native-session-delete@1.0.6
```

Use the same `add` command to update or repair. On Windows, `install.ps1` from the same fixed Release may
be used only as a thin locator and launcher. It checks bounded known locations and up to three nested levels
under common user/temporary roots, then invokes the exact command
above once. It must not scan disks recursively, download package-manager components, save profile snapshots,
create a persistent manager command, modify another profile, or restart DSH automatically. The DSH CLI owns
dependency resolution and bundle composition.

After a successful configuration change, ask for permission before restarting DSH. A successful CLI exit
alone is not runtime acceptance.

## Acceptance

First verify the selected profile without exposing its contents:

```sh
dsh plugin --profile web list dsh-native-session-delete --depth 0
```

Use `.\dsh.exe` in place of `dsh` for DSH-Portable. Static acceptance requires:

1. The `dsh-native-session-delete` bundle appears exactly once in the requested profile.
2. Its direct package spec is the fixed `dsh-native-session-delete@1.0.6` npm version above.
3. The profile contains the bundle patch and no duplicate official workspace row from this plugin.
4. No unrelated dependency, profile patch, or session data was changed by the operation.

With permission to restart DSH, verify the live UI in dark mode:

1. The selected session's native actions menu contains **Archive session** and the red **Delete session…** action.
2. Opening Delete shows the target session name and a second confirmation.
3. Selecting **Cancel** closes the dialog, sends no delete request, and leaves the session visible.
4. A destructive check is allowed only with a disposable test session explicitly selected by the user.
5. After confirming that disposable session, verify it disappears in place without reloading the whole DSH page.

For source-checkout UI acceptance, the non-destructive smoke test is:

```sh
pnpm smoke:ui -- --url http://127.0.0.1:14171 --session "Exact session title"
```

The title must identify the intended session. The runner must only open the dialog and cancel it; it must
not send a deletion request or manage the DSH process.

## Uninstall

For a standard profile:

```sh
dsh plugin --profile web remove dsh-native-session-delete
```

For DSH-Portable:

```powershell
.\dsh.exe plugin --profile web remove dsh-native-session-delete
```

Uninstall removes only this plugin's bundle layer. It must not delete sessions and must not restart DSH
without permission. After the command, verify that `dsh-native-session-delete` is absent and that the
official workspace row is available again after the next permitted DSH restart.

## Failure handling

Distinguish command discovery, network, HTTP/TLS, package-manager, profile-conflict, version, and
peer-dependency failures. Do not disable TLS validation, delete a profile, replace unrelated packages,
or claim success from an exit code alone.

On failure, report the sanitized command error, DSH version, selected profile, requested plugin version,
what changed, rollback state, and what remains unverified. Do not attempt an irreversible session deletion
as a recovery step. If the bundle was added but verification failed, stop and obtain permission before any
further profile change.
