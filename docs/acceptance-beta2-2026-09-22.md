# Chat Manager 1.4.0-beta.2 candidate acceptance

The current user's Portable profile has 1.3.5 installed but does not enable its bundle. Its native menu therefore contains archive but no plugin deletion action. No user profile or session was changed.

The development lifecycle fix is assigned a new immutable candidate number, 1.4.0-beta.2; it must not be confused with the published beta.1 artifact. Not yet published or installed into the user's Portable.

Validation on Windows, headless Chrome, official DSH 0.1.6-alpha.2, freshly installed candidate tarball:

- 98 source/package tests passed.
- Native red delete item, archive settings permanent deletion, restore, search, confirmation and cancel passed.
- Deletion removed only a synthetic transcript; no reload or browser runtime errors.
- Four plugin enable/disable transitions preserved an editable composer; typed and cleared a synthetic draft without sending a model request.
- Evidence: `.artifacts/acceptance-beta2-lifecycle-fixed-20260922.log` and its isolated evidence directory.

Original acceptance failures remain recorded. Windows pnpm.cmd seeded a title containing literal quotes; the fixture now uses a shell-independent title. The lifecycle harness initially assumed the New session entry was a button; it now uses the visible navigation label. Failed modern acceptance captures a screenshot and synthetic page text before closing the browser.

Remaining: release CI on the exact candidate, immutable npm/GitHub publication, Portable default-plugin lock update after registry integrity is available, and user installation acceptance without changing their disabled preference implicitly.


## Final visual qualification

Visual inspection found duplicated archive tabs on unmodified upstream alpha.2. Its settings navigation enumerates shadowed registrations. The enhanced archive page is now enabled only on Portable hosts exposing the settings adapter; stock DSH retains its native archive page and the plugin supplies the native red delete menu. This avoids an intrusive settings-service replacement. README documents this boundary.

Final package source passed 98 tests. Stock DSH light and dark runs passed one-tab navigation, native delete/cancel, and four enable/disable transitions with real editable-composer checks. Portable's actual cached alpha.2 runtime was used read-only with a separate synthetic profile; three toggles, single settings archive tab, restore/search/permanent delete and no browser exceptions passed. No current user profile was changed. Evidence: `.artifacts/visual-beta2-fixed.log`, `.artifacts/visual-beta2-light.log`, `.artifacts/portable-beta2-v2-20260922.log` and screenshot directories. These are headless browser acceptance against real hosts, not Windows WebView2 foreground acceptance.

The first Portable count assertion included the sidebar shortcut; the corrected assertion scopes to the Settings dialog. The screenshot confirmed one tab. The earlier stock duplicate was real and was corrected in product source.

## Sidebar archive entry

The final Portable run clicks the sidebar archive icon directly, repeatedly opens/closes the Settings archive page, and confirms no legacy archive dialog, one Settings tab, working restore/delete and no browser exceptions. Screenshot `portable-beta2-sidebar-shortcut.png` confirms the icon above the session tree. The disabled plugin contributes no icon by design. Official alpha.2 archive search matches only title/workspace; the extension adds message-content search. Evidence: `.artifacts/portable-beta2-shortcut-20260922.log`.

Release CI originally failed because its English New Session label differed from a case-sensitive locator. The corrected accessible-role locator passed the English real-host run and 16 delivery tests; product behavior was not changed for that harness failure.

## Publication and immutable artifact acceptance

Published v1.4.0-beta.2 from 0eb3390698eaec92872e968d1af0ab88d00f1e33, successful release run 35689541443. npm beta and GitHub asset checksums agree (SHA-256 8b11da326141b95a36d1112d281e2067802a77fa6b96faa2e371e8aa8ab19650). The published tarball was downloaded and reinstalled into a fresh synthetic Portable profile; sidebar shortcut, repeated Settings close/open, body-only archive search, restore, delete/cancel, three lifecycle toggles and editable composer passed. Evidence: `.artifacts/portable-beta2-published-20260922.log`. The current user profile remains disabled and untouched. Portable preview integration is updated separately; a future Portable product release remains distinct from this plugin release.
