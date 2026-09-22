# Official 0.1.7 session slots — candidate acceptance

This is an opt-in source candidate, not a published plugin or a supported-core declaration. Default builds remain on the verified alpha.2 adapter. Set `DSH_CLIENT_TARGET=0.1.7-alpha.1` for the candidate build.

The new client imports React and official UI primitives, registers one `sidebar.workspaces.session.menu.item` plus one `shell.overlay`, and does not import/copy/replace the workspace module, header or layout CSS. Official pin, rename, fork, archive, filtering and running-session confirmation stay official-owned. The existing settings section retains archive content search and confirmed permanent deletion until upstream offers those extension points.

Acceptance on Windows with actual published DSH 0.1.7-alpha.1, an isolated DSH home and background Chrome:

- Official menu retains pin/rename/fork/archive and adds a red permanent-delete item; confirmation matches official Modal/Button styling. Screenshots were visually inspected.
- Cancel sends no deletion; a disposable V4 session was deleted successfully.
- Three plugin enable/disable transitions preserved an editable composer, with zero browser page errors.
- Settings contains one archive section; a content-only marker absent from the title matched an archived V4 session. The red delete action, cancelled confirmation and confirmed deletion passed.
- 103 repository tests passed.

Failures retained: initial icon import used the old `IconTrashOutline16`, which no longer exists; switched to the verified `IconTrashOutlineRegular`. Direct menu color styling was ignored by MenuItemButton; switched to its public `danger` property. New stores do not all expose refresh(); refresh is optional. Archive actions previously read optional services directly from ctx; use guarded public get() lookup to avoid a post-deletion UI failure. Harness corrections included the current accessible new-session label and expanding the ungrouped folder. Initial failures are not erased by later passes.

Local evidence is in the sibling Portable checkout build directory: alpha7-menu.png, alpha7-delete-confirm.png, alpha7-lifecycle-result.log, alpha7-archive-content-search.png, alpha7-archive-lookup-fix.log, and the original *failure* logs. The full source test result is .artifacts/alpha7-plugin-full-tests.log.

Still pending: light theme, active-session deletion, archive restoration, native WebView2, distribution packaging/peer declarations, old-to-new plugin upgrade and integration with the Portable candidate. Do not publish this candidate as fully qualified.
