---
"@nextlyhq/ui": patch
"@nextlyhq/admin": patch
---

Fix the pervasive faint borders across the admin. The default component border (previously the primary color at 5% opacity, effectively invisible) now uses the `border` design token, so cards, dialogs, tables, forms, groups, repeaters, sections, and the block builder all have clearly visible, consistent hairlines in light and dark mode. Fully monochrome.
