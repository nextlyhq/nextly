---
"@nextlyhq/ui": patch
"@nextlyhq/admin": patch
---

Make default badges legible in dark mode. The default badge (used for table values like media type, plugin placement, and statuses) used a ~5%-opacity background that was nearly invisible on dark surfaces; it now uses the muted surface token so the chip and its text read clearly in both light and dark.
