# Workspace ownership and plugin toggling

The reported sequence is enable chat manager, disable it, then return to a new
conversation: the composer disappears. The old bundle disabled the official
workspace service and substituted its own owner of retained session references.
Isolated alpha.2 activation reproduced `uiConversation.binding: unknown session`.
A fresh browser on the same user host rendered an editable composer, so a healthy
new connection did not prove the existing desktop page was healthy.

The development 1.4 candidate keeps the official service, root hooks, and hero
picker. It overrides only the sidebar view and archive settings. Its private child
slot forwards the official directory picker providers using public registry APIs;
disposal removes only forwarding registrations. Locale and CSS identities are
separate from the official module. Previous builds for older cores remain
historical releases; `releaseTargets` defines this candidate's alpha.2 scope.

## Evidence

Local artifacts under `.artifacts/official-alpha2-acceptance-20260919/`:

- `lifecycle-native-acceptance-evidence.json`: old implementation activation
  errors retained. This first harness also incorrectly expected a close button
  on the full plugin page; later harnesses return via the sidebar.
- `lifecycle-fixed-native-acceptance-evidence.json`, final run
  `run-lifecycle-fixed7-20260920`: enable/disable/enable through the official
  plugin manager, extension presence/absence verified, composer editable after
  every step, zero browser errors. No reload or backend restart between toggles.
- `extension-native-acceptance-evidence.json`, final run
  `run-view-extension7-20260920`: enabled-plugin cold start, native delete menu,
  archive restore, red delete button, cancel without deletion, and permanent
  deletion of a synthetic transcript. Zero browser errors; composer editable
  after closing settings. No model request or user transcript deletion.
- Earlier failed experiments retained: duplicate child-slot declarations,
  missing child renderer, and official CSS tag identity suppression were fixed
  before these passing runs. Earlier composer-only checks were insufficient to
  prove the extension itself activated; final checks assert its presence too.

98 unit/contract tests pass. These are hidden Chrome checks against the real
official alpha.2 host, not native WebView2 acceptance. The user's running install
has not been replaced, and no release was published by this change.
