---
"@revnixhq/admin": minor
---

Compact the entry create/edit page layout. The borderless title input now
lives in the system header row alongside Save Draft / Publish (or Save), a
single consolidated `⋮` dropdown (Discard · Duplicate · Show JSON · View API
response · Delete), and a rail toggle on the right edge. Removed: the
breadcrumbs row, the DocumentTabs row (Edit / API / Versions Soon / Live
Preview Soon), the redundant `New X` / `Create X` headings, the duplicate
Show JSON dropdown that lived in the old EntryFormHeader, and the Revisions
/ Activity placeholder rail panels. The right rail now shows only the
Document panel: a Status row when the collection has Draft/Published
enabled, an ID row with a copy-to-clipboard button, Created, and Updated.
A new EntryMetaStrip below the system header surfaces the slug (with
inline pencil-to-edit) and, when the rail is collapsed and the collection
has status enabled, a neutral-palette status pill so editors don't have
to re-open the rail to see document state. SingleForm parity ships in a
follow-up PR.
