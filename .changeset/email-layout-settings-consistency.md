---
"@nextlyhq/admin": patch
---

Hide send-only settings (provider, active, attachments) when editing an email layout row. A layout never sends on its own, so its Settings now show only the `{{content}}` hint and slug, matching the fields that already hid for layouts.
