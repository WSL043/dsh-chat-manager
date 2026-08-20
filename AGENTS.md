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

The fixed v0.1.5 package spec is:

```text
@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.5/dsh-session-delete.tgz
```

## Detect DSH

First check the requested profile and available commands with filesystem
read-only operations. On Windows:

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

`dsh plugin ... list` is not strictly read-only. It is
non-destructive to sessions, but its first invocation may initialize or migrate
a Portable profile, reconcile `dsh.profile.bundles`, rebuild pnpm links, or
update profile package-manager files. If exact change attribution matters,
snapshot the selected profile's relevant metadata before invoking it.

## Install or update

With an existing `dsh` command:

```sh
dsh plugin --profile web add "@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.5/dsh-session-delete.tgz"
```

With DSH-Portable, run from its root:

```powershell
.\dsh.exe plugin --profile web add "@deepseek-ai/dsh-client-ui-workspace@https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.5/dsh-session-delete.tgz"
```

Use the same command for v0.1.5 update or repair. Do not restart DSH
automatically.

The Release includes `dsh-session-delete.tgz.sha256`. When downloading assets
before installation, verify the tarball's SHA-256 against that sidecar. Do not
treat a hash copied from an unrelated page or prior version as evidence.

## Verify

Run the matching CLI:

```sh
dsh plugin --profile web list @deepseek-ai/dsh-client-ui-workspace --depth 0
```

Static success requires all of the following:

1. The dependency appears exactly once under the requested profile.
2. The direct dependency spec is the fixed v0.1.5 Release URL.
3. The installed alias directory
   `node_modules/@deepseek-ai/dsh-client-ui-workspace/package.json` reports
   `name: "dsh-session-delete"` and `version: "0.1.5"`.
4. No unrelated dependency, profile patch, or running DSH process changed.

A live UI check requires permission to restart DSH. After restart, open the
explicitly selected session's actions menu and verify **Archive session** and
the red **Delete session** are both present. Open the delete action and verify the
second confirmation modal, then cancel it. Cancellation is the default
non-destructive acceptance check.

For an automated check from a source checkout, install dependencies and the
Playwright Chromium browser, then run:

```sh
pnpm smoke:ui -- --url http://127.0.0.1:14171 --session "Exact session title"
```

The explicit title is mandatory. The script must only open the delete dialog
and cancel it; it must not send the deletion request or manage the DSH process.

To verify successful deletion settles without a WebView reload while preserving
all user sessions, run the isolated fixture check:

```sh
pnpm smoke:ui -- --url "http://127.0.0.1:14171/?fixture" --session "Fixture 历史会话" --simulate-delete-success
```

The simulated-success flag is rejected unless the URL contains `?fixture`. The
runner intercepts the delete route before Host, asserts one request, an unchanged
document token, zero main-frame navigations, and a closed confirmation dialog.

Only if the user explicitly authorizes a destructive test, create or select a
disposable session, confirm deletion in the modal, and verify that it disappears
in place without a page reload. A separate manual reload may then verify that it
stays deleted. Never use an existing user session for this check.

## Expected package-manager notices

This package contributes `dsh.client`, not `dsh.bundle`. A bundle declaration
means a profile configuration patch layer; adding an empty one merely to remove
a warning would misrepresent the plugin. A missing `dsh.bundle` notice is
therefore expected for this client-only replacement and is not an installation
failure when the alias and runtime checks pass.

The DSH host supplies the Cordis, connection, client-runtime, UI, invariants,
and React peers. These peers are optional and explicitly accept the tested DSH
rc.6, rc.7, and rc.8 host versions. If `pnpm peers check` still reports another
installed package, attribute the warning to the named package rather than this
plugin.

Future DSH versions are not automatically supported. Dependabot may open an
upstream workspace dependency update, but do not widen peer ranges or publish
from that update alone. Rebuild against the exact new upstream client and pass
the compatibility tests plus the installation, startup, native-menu,
confirmation, no-reload, and disposable-session deletion checks first.

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
