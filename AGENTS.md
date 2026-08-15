# Agent installation guide

Use this guide when a user asks an Agent to install, update, verify, or remove
`dsh-session-delete`.

## Safety

- Confirm the target DSH profile. Use `web` only when it is the user's target.
- Use a fixed GitHub Release asset, never a moving branch.
- Do not print session contents, full profile files, local transcript paths, or
  other credentials and private data.
- Do not start, stop, or restart DSH without explicit permission.
- Preserve all sessions, unrelated plugins, and user-owned profile patches.
- Never delete a session as an installation test unless the user explicitly
  selects a disposable session and confirms the destructive test.
- If more than one DSH installation is present, ask which installation is the
  target before changing anything.

## Important package identity

This plugin must replace the dependency key
`@deepseek-ai/dsh-client-ui-workspace`. Installing the Release URL by itself,
or installing it under the name `dsh-session-delete`, does not prove that the
native workspace menu was replaced.

The fixed v0.1.0 package spec is:

```text
@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.0/dsh-session-delete.tgz
```

## Detect DSH

First check the requested profile and available commands with read-only
operations. On Windows:

```powershell
Get-Command dsh -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath . -Filter dsh.exe -File -ErrorAction SilentlyContinue
```

For DSH-Portable, a valid root normally contains `dsh.exe`,
`runtime\node\node.exe`, and
`app\node_modules\@deepseek-ai\dsh\lib\bin.js`. Missing system Node.js or
pnpm is normal for DSH-Portable and is not a reason to install either globally.

Before installation, locate the selected profile's `package.json` and record
only whether `dependencies["@deepseek-ai/dsh-client-ui-workspace"]` exists and
its non-secret package spec. Do not print the rest of the profile. This original
value determines whether uninstall should remove the key or restore a prior
explicit pin.

## Install or update

With an existing `dsh` command:

```sh
dsh plugin --profile web add "@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.0/dsh-session-delete.tgz"
```

With DSH-Portable, run from its root:

```powershell
.\dsh.exe plugin --profile web add "@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.0/dsh-session-delete.tgz"
```

Use the same command for v0.1.0 update or repair. Do not restart DSH
automatically.

## Verify

Run the matching CLI:

```sh
dsh plugin --profile web list @deepseek-ai/dsh-client-ui-workspace --depth 0
```

Static success requires all of the following:

1. The dependency appears exactly once under the requested profile.
2. The direct dependency spec is the fixed v0.1.0 Release URL.
3. The installed alias directory
   `node_modules/@deepseek-ai/dsh-client-ui-workspace/package.json` reports
   `name: "dsh-session-delete"` and `version: "0.1.0"`.
4. No unrelated dependency, profile patch, or running DSH process changed.

A live UI check requires permission to restart DSH. After restart, open a cold
session's actions menu and verify **Archive session** and **Delete session…** are
both present. Open the delete action and verify the second confirmation modal,
then cancel it. Cancellation is the default non-destructive acceptance check.

Only if the user explicitly authorizes a destructive test, create or select a
disposable cold session, confirm deletion in the modal, and verify that the
session no longer appears after reload. Never use an existing user session for
this check.

## Uninstall

For a standard profile with no prior explicit workspace dependency:

```sh
dsh plugin --profile web remove @deepseek-ai/dsh-client-ui-workspace
```

For DSH-Portable, use `.\dsh.exe` with the same arguments. If the pre-install
check found an existing explicit workspace dependency, restore that exact
non-secret package spec with `add` instead of removing the key.

Verify that the `dsh-session-delete` package is no longer installed under the
workspace alias. Uninstall must not delete any session and must not restart DSH
without permission.

## Failure handling

Distinguish command discovery, network, HTTP, TLS, package-manager, profile
conflict, version, and peer-dependency failures. Do not disable TLS validation,
delete a profile, replace unrelated packages, or claim success from an install
exit code alone.

On failure, report the sanitized command error, DSH version, selected profile,
requested plugin version, what changed, rollback state, and what remains
unverified. If the dependency changed but verification failed, restore the
recorded pre-install dependency value before stopping.
