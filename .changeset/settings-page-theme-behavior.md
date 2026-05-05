---
"@revnixhq/admin": minor
---

Restructure `/admin/settings` to use the shared `SettingsSection` layout: small uppercase label outside the card, no in-card heading, no per-row icons. Theme tile now previews instantly but only commits to localStorage on Save; navigating away with unsaved changes snaps back to the previously saved theme.
