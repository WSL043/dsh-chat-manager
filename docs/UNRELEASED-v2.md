# Unreleased v2 preparation

This maintenance branch prepares package version 2.0.0-alpha.1; it is not a
published or qualified release. The generated client must be rebuilt and verified
from this source before acceptance. Publication workflows remain unchanged and
are not permission to publish. Do not install this working tree into a daily profile.

The v2 source targets only the public contracts inspected at DeepSeek Harness
0.2.2-alpha.2 commit f3803c96974ad4a94195fb97e5c637e9c2a3afe3.
No v2 real-product compatibility has been established. The RC or Portable
compatibility promises of 1.5.19 do not carry over to this preparation.

- Normal search, archive, stop-and-archive and restore stay with official DSH.
- One additive public settings section searches archived message content with
  archive IDs applied before the result limit. It retains the bounded-concurrency
  event scan when the optional full-text index is disabled. Results and snippets
  remain limited, and superseded requests are cancelled.
- The settings section and archived row menu share one named delete confirmation.
  Permanent deletion requires an archived, unloaded, current-format local JSONL
  session and an exclusive official persistence write handle held through cleanup.
  Loaded idle/running sessions, other writers and historical/unknown formats are
  refused. The plugin does not stop agents or migrate sessions for deletion.
- Public refresh and unarchive operations reconcile lists. No workspace copy,
  private navigation/state access, global lifecycle wrapping, or Portable settings
  global is used. Stopping or archiving does not promise that an Agent is unloaded.
- Deletion is irreversible, is not secure erasure, and excludes external
  attachments, caches, logs, backups, cloud copies and non-JSONL stores. Partial
  cleanup retains the quarantine and is reported; an archive reconciliation failure
  remains visible for retry.

Before release, the maintainer must align the package files, dependency/lock and
compatibility metadata, regenerate the client, then qualify a fixed official core
in an isolated disposable profile. Required checks include cancel-without-request,
archive-only search beyond the global result cap, index-disabled cancellation,
cold archived deletion preserving neighbours, live/busy/migration refusal,
reopen/lease races, HMR/unload, partial cleanup and narrow/dark UI. Destructive
acceptance requires explicitly selected disposable fixture sessions. No user
profile or existing Portable package may be used as test data.

## Compatibility automation hold

The existing compatibility preparation script assumes a newest-five-core window
and at least two release candidates/finals. Its plan and README rewrite functions
require five targets; its next-release/documented-version functions only handle
stable or beta plugin versions. It may widen Cordis peers and regenerate legacy
fixture metadata. These paths need a v2 fixed-target/prerelease guard before use.
An empty portableBaselines list currently adds no old baseline by itself.

The unchanged upstream-compatibility workflow selects the five-core window, can
write/commit compatibility metadata and can dispatch the trusted publish workflow.
Do not invoke it for this unpublished v2 candidate. No workflow was changed here;
a maintainer must separately review guards before any automation is enabled for v2.
