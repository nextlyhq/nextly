---
"@nextlyhq/admin": patch
---

Add a read-only view of code-first schemas. Previously a code-first collection, single, or component could not be opened from the builder list at all — the row was inert and its menu action was disabled — so its structure was impossible to inspect. Clicking such an entry (or its "View" action) now opens the builder in read-only mode. The builder shows a "Read-only" badge in the toolbar and a notice explaining the entity is managed in code (with its source file path when available), every field is inspectable but disabled, and the settings dialog opens read-only — the Settings button stays enabled so labels, slug, icon, and advanced options can be viewed, with all controls disabled and the footer collapsed to a single Close button. Editable (UI-created) schemas are unchanged.
