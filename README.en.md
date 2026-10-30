# DSH Chat Manager

**This branch prepares the independent v2 candidate `2.0.0-alpha.1`. It passed isolated Windows UI acceptance on official Alpha2 and remains unpublished.**
See the [latest stable Release](https://github.com/WSL043/dsh-chat-manager/releases/latest); install the npm `latest` stable tag.
This working tree is a different candidate and inherits none of that release's RC or old Portable compatibility claims.

[简体中文](README.md) · [Unreleased scope](docs/UNRELEASED-v2.md) · [Safety boundary](#safety-boundary)

## v2 scope

Official DSH owns normal session browsing, search, archive, stop-and-archive and unarchive.
This plugin adds one public-slot settings page for archive content search and cleanup:

- Search current user and assistant messages within archived IDs before applying the result limit, with plain-text snippets.
- Keep a four-concurrent-scan fallback when the optional full-text index is disabled. At most 20 results are returned; cancelling or changing a query stops subsequent batches.
- Restore through the official public unarchive operation, preserving the recorded workspace position.
- The settings page and archived row menu share a second confirmation naming the exact session. Cancellation sends no delete request.
- Permanent deletion requires an archived, unloaded local session in current JSONL format and an exclusive official persistence write handle.
  Loaded idle/running sessions, other writers, migration-required and unknown formats are refused.

Stopping work or archiving does not guarantee that the host unloaded the session.
The plugin does not stop or dispose another component's Agent and does not migrate sessions for deletion.
After an operation it refreshes public lists; navigation stays with official DSH.

This is an independent plugin. This work does not preinstall it into official Desktop 1.x or modify an official ASAR.

## Candidate compatibility boundary

<!-- dsh-compatibility -->
The fixed v2 target is DeepSeek Harness `0.2.2-alpha.2` commit
`f3803c96974ad4a94195fb97e5c637e9c2a3afe3` with Cordis `4.0.6-alpha.1`. Isolated Windows UI acceptance passed on that official Alpha2. No RC or old Portable baseline is claimed.
The test used generated sessions; existing user installations and real-model calls were not validated.
<!-- /dsh-compatibility -->

See the [stable maintenance branch](https://github.com/WSL043/dsh-chat-manager/blob/stable/README.en.md) for its support window. This v2 candidate remains unpublished and inherits no stable compatibility claims.

## Install, update and uninstall

Do not install this working tree or unpublished candidate into a daily profile.
For the stable release, check the target DSH, profile, actual version resolved by `latest`, and its peer requirements.
Follow the [stable installation guide](https://github.com/WSL043/dsh-chat-manager/blob/stable/AGENTS.md)
and enter `dsh-chat-manager@latest` on the official **Plugins → Add plugin** page.
Do not infer publication or host suitability from this branch's package.json.

Install, update and uninstall only the selected plugin layer; preserve sessions, unrelated plugins and user configuration.
Restart DSH only with the user's permission. Remove the plugin through the official plugin page; uninstalling does not delete sessions.
Agents must follow [AGENTS.md](AGENTS.md) and the stable guide above, pinning the verified resolved version when installing.

Stable maintenance checks upstream every 3 hours. Compatibility patches publish automatically to npm and GitHub Releases after acceptance; failures block publication and report an error. This process does not publish or widen support for the v2 candidate.

## Safety boundary

**Permanent deletion cannot be undone.** Verify the named target and back up anything needed before confirming.
The plugin validates and removes only the confirmed session's independent JSONL directory.
Uncertain paths, identity or writer ownership are refused. Incomplete cleanup retains the quarantine and is reported;
a failed archive-marker update remains visible.

This is not secure erasure. External attachments, caches, logs, backups, cloud copies, other sessions and non-JSONL stores are outside its scope.
A destructive acceptance test requires a disposable fixture session explicitly selected and confirmed by the user.

## Feedback and license

[Report an issue](https://github.com/WSL043/dsh-chat-manager/issues/new?template=bug-report.yml) ·
[Security](SECURITY.md) · [MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)

This unofficial community plugin is not affiliated with or endorsed by DeepSeek.
