---
"@nextlyhq/admin": patch
---

Fix the email template editor's HTML/Plain-text toggle and preview. Each editor tab now mounts its own form field (via a stable React key), so toggling repeatedly no longer leaks one field's content into the other or blanks them out. The preview mirrors the editor tab (removing a confusing duplicate format toggle), its iframe remounts on format/theme change so sandboxed content reliably re-renders, and the light/dark toggle now emulates a light or dark email client (activating the email's own `prefers-color-scheme` styles) instead of only recoloring the page margin.
