---
"@revnixhq/admin": patch
---

Fix: fields with `admin.width` (e.g. 50%, 33%) now correctly pack into rows on the entry create/edit page. Previously a field with `width: '50%'` rendered at half-width but on its own row, never side-by-side with the next field. Block-style fields (Group, Array, Blocks, Component, RichText, Tabs, Row, Collapsible) continue to render full-width on their own row regardless of `admin.width`.
