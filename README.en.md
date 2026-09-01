# DSH Chat Manager

The existing removable DeepSeek Harness chat-management plugin, now narrowed to one current native gap: restoring archived sessions.

## Capabilities

- Lists the official archive set under Settings → Plugins → Session Recovery.
- Restores one session while preserving its log, workspace order, and unrelated settings.
- Uses the official session and workspace snapshots without replacing the native workspace UI.

It does not search message content, permanently delete sessions, or replace native search, fork, or archive behavior.

## Install or remove

```powershell
pnpm add dsh-chat-manager@beta
```

DSH-Portable may install it for a brand-new environment. Removing it is a durable user choice; Portable updates do not reinstall a removed default plugin.

## Compatibility

Built for the plugin contracts in DeepSeek Harness `0.1.1-rc.2`, `0.1.2-alpha.2`, and `0.1.2-alpha.3`. Final compatibility is established by the corresponding Portable installed-product acceptance.
