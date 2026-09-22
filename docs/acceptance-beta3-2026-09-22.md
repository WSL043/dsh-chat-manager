# Sidebar header clipping regression

The previous visual check confirmed that the archive action existed but missed an original action being clipped. This was a real product regression: the official headerActions maximum width is 60px (two 28px buttons and one 4px gap); injecting archive requires 92px. Add workspace remained in the DOM but its pixels and click target were outside the clipped area.

The extension now reserves 92px while retaining the official collapsed-search max-width:0 rule. Archive also has a hover label. A changed upstream CSS marker fails explicitly. Acceptance now hit-tests both edges of every header button, rather than relying on DOM visibility alone.

99 tests passed. On the user's actual Portable service, a headless browser verified all four header actions at 1440px and 1280px viewport widths, clicked search and Add workspace, and captured the complete header. Screenshots were visually inspected. At compact responsive widths the official layout intentionally changes; this is not treated as four wide-mode buttons. The user's plugin remains enabled. No user sessions were deleted.

This evidence does not prove that an already-open native WebView has refreshed its cached stylesheet; the live server serves the fixed client to newly loaded pages. Local evidence is under .artifacts/beta3-live-sidebar.png and check-live-header.mjs. Do not publish user screenshots as release assets.
