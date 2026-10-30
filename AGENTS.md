> Unpublished candidate: dsh-chat-manager@2.0.0-alpha.1. Fixed target: DSH 0.2.2-alpha.2 at f3803c96974ad4a94195fb97e5c637e9c2a3afe3, Cordis 4.0.6-alpha.1. Isolated Windows UI acceptance passed on official Alpha2 using generated fixtures, without validating an existing user installation or real-model calls; this candidate remains unpublished and no other cores are claimed.

# Agent maintenance and installation boundary

This working tree prepares an independent v2 plugin. It is not the npm `latest` stable
package and must not inherit the stable line's RC or old Portable compatibility
claims. This work does not preinstall a plugin into official Desktop 1.x or modify
an official ASAR. Read [docs/UNRELEASED-v2.md](docs/UNRELEASED-v2.md) before maintenance.

## Installation protection

- Respect the current user's action limits. Source review or edits do not authorize
  installing, restarting, deleting sessions or publishing.
- Confirm the exact DSH installation and profile before any authorized plugin operation.
  Do not default to web when the user's target is desktop or unclear.
- Do not install this unpublished candidate into a daily profile. For an explicitly
  requested stable release, consult the dynamic [stable support window](https://github.com/WSL043/dsh-chat-manager/blob/stable/README.md)
  and [stable installation guide](https://github.com/WSL043/dsh-chat-manager/blob/stable/AGENTS.md).
  Resolve `dsh-chat-manager@latest` to its actual published npm version, verify its
  peer requirements against the target DSH and profile, then install that exact
  resolved version. Do not install a moving source branch.
- Use the official plugin page or standard dsh.bundle lifecycle. Never replace the
  official workspace module or patch an official ASAR to install this plugin.
- Preserve all sessions, unrelated plugins, pairing and user-owned profile changes.
- Do not print session contents, full profile files, transcript paths, credentials,
  tokens or private account data.
- Do not start, stop or restart DSH without explicit permission. A CLI success or
  package/peer match alone is not product acceptance.
- A dsh plugin list operation can initialize or migrate profile metadata; do not
  describe it as a filesystem-only read.

## v2 deletion contract

Official DSH owns normal archive, stop-and-archive, unarchive and navigation.
The plugin contributes archive-only content search and confirmed permanent cleanup
through public slots. It must not capture foreign AgentHandle capabilities, patch
shared lifecycle methods, read private navigation state or write private registry state.

Permanent deletion is irreversible. The confirmation must name the exact target;
cancelling is the safe default and must not send a delete request. A target must be
archived, unloaded, local and current-format JSONL, with an exclusive official
persistence write handle held through the operation. Refuse loaded idle/running
sessions, another writer, historical/unknown formats, unsafe paths or changed identity.
Stopping or archiving does not promise that an Agent has been unloaded. Do not
stop/dispose another owner or migrate sessions merely to delete them.

Never delete a session as an installation test unless the user explicitly selects a
disposable session and confirms the destructive test. Use generated fixture data in
an isolated disposable profile; do not use an existing user profile or Portable
package for acceptance. Pending work, Windows writer locks, reopen races and HMR
require real isolated acceptance before compatibility can be claimed.

The plugin is not secure erasure. External attachments, caches, logs, backups,
cloud copies, other sessions and non-JSONL stores are outside its scope. Keep the
quarantine when cleanup is incomplete and report partial state truthfully. Do not
hide an archive-marker reconciliation failure or claim success from missing UI rows.

## Update, removal and failure handling

Update or remove only the explicitly selected plugin layer. Removal does not delete
sessions. Verify the affected layer and preserve unrelated configuration; do not
restart DSH without permission. On failure, report sanitized evidence, target host,
requested version, changes, rollback state and what remains unverified. Never disable
TLS validation, delete a profile, replace unrelated packages or attempt a destructive
session test as recovery.

Stable maintenance checks upstream every hour and publishes compatible patches
to npm and GitHub Releases only after acceptance. Failures block publication and
report an error. This process does not define v2 admission or publish or widen this
fixed candidate; v2 publication and lock refresh remain separate maintainer actions.
