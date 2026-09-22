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
