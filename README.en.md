# DSH Chat Manager

[简体中文](README.md) · [Releases](https://github.com/WSL043/dsh-chat-manager/releases) · [Qualified DSH versions](compatibility.json)

DSH Chat Manager adds archive-only message search and confirmed cleanup to DeepSeek Harness. Open **Settings → Archive cleanup** to find archived messages. Use the archived session's context menu or its search result to request permanent deletion. Both entries show the session name and ask for confirmation.

DSH provides the workspace, regular search, archive, restore, and the shared session menu. The archive search narrows the official query to archived sessions before the result limit. It uses bounded event filtering when the optional full-text index is disabled.

## Install or update

Open **Plugins → Add plugin** in official DeepSeek Harness 0.2.2-rc.1 and paste this package spec:

```text
dsh-chat-manager@2.0.0
```

Check the [qualified DSH versions](compatibility.json) for newer v2 releases. The [v1 maintenance line](https://github.com/WSL043/dsh-chat-manager/tree/stable) documents earlier versions.

V2 starts with DSH 0.2.2-rc.1. Future compatibility patches are prepared from official releases and tested on the new core and the preceding supported core before publication. See the [maintenance guide](docs/stable-maintenance.md).

## Permanent deletion

Permanent deletion cannot be undone. Only archived, unloaded local sessions using the current JSONL format can be deleted. The plugin acquires the official exclusive write handle and verifies the target before removing it. Active sessions, other writers, and historical formats are refused. An incomplete cleanup keeps the archive marker and reports the retained quarantine.

External attachments, caches, backups, cloud copies and non-JSONL stores fall outside this operation. Uninstalling the plugin preserves sessions.

[Report an issue](https://github.com/WSL043/dsh-chat-manager/issues/new/choose) · [Security](SECURITY.md) · [MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)

This community plugin is independent of DeepSeek.
