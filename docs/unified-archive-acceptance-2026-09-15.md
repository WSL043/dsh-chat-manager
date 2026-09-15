# Unified archive candidate

User correction: retain Plugins / Installed during download and installation,
including installation-triggered reloads. An explicit restart must return to the
conversation. The earlier restart-to-settings observation below is superseded as
the desired behavior; the candidate now clears restoration on explicit restart.
Permanent deletion uses the existing theme-aware red delete-action class in both
the archive row and the confirmation dialog.

Unreleased 1.3.6 requires Portable's v3 settings navigation for the unified page.
Older hosts retain the legacy archive dialog and do not get a second settings row.
The official section is shadowed through the public slot priority, not disabled in
the profile. Portable lists each effective section id once.

Windows browser acceptance used official DSH 0.1.6-alpha.1 in an isolated profile:

- Sidebar archive action opened Settings directly, with one archive navigation row.
- The page included search, Unarchive and permanent deletion.
- Cancelled deletion preserved the disposable session; confirmed deletion removed it.
- Reload restored the selected settings section. Explicit close cleared restoration.
- Actual market update from chat manager 1.3.3 to 1.3.5 returned to Plugins / Installed.
- Market-driven backend restart returned to Installed and showed 1.3.5 active.
- This empty test profile repeatedly showed upstream API-key onboarding after reload;
  it was dismissed without configuring credentials or sending model requests.

Not qualified: native WebView2 replacement latency on the user's current machine,
or a complete Portable distribution containing this candidate. Do not publish this
plugin alone as a fix for older Portable navigation.
