---
"@nextlyhq/admin": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-form-builder": patch
---

The form-builder submissions list now renders through the unified admin data table. `DataTable` and `DataTableView` are exported from `@nextlyhq/plugin-sdk/admin` (and `@nextlyhq/admin`) so plugins can render lists that match the admin exactly, and the form-builder's `SubmissionList` uses `DataTableView` instead of a hand-rolled table — gaining consistent styling, sortable-ready headers, a responsive card layout, and the shared cell renderers, with selection, status filtering, per-row and bulk actions, and export unchanged. The submissions list is keyed `"form-submissions"` so plugins can extend it via the DataTable registries.
