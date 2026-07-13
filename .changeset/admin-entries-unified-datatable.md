---
"@nextlyhq/admin": patch
---

The collection entries list now uses the unified admin data table. Rows navigate to the entry on a whole-row click (matching every other list), columns are generated from the collection schema and render through the shared field-type renderers, and headers sort server-side with a direction indicator. Search, status and date filters, column visibility (with per-collection persistence), selection, bulk delete, and bulk publish/unpublish (for collections with the draft/published lifecycle) all behave as before, and the list collapses to a card layout on narrow screens.
