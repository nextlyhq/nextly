---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

The submissions list finally shows what people submitted.

**Per-field columns.** Pick a form and the table's columns become that form's fields — Name, Email, Message — with the standard hide/show column selector. Across all forms you get Form, a data summary, Status, and Submitted. (Submission data is stored keyed by field name, which is what makes real columns possible.)

**Drawer detail with prev/next.** Click a row for the full submission: values in field order, keys no longer on the form shown honestly, metadata (IP, agent, ID), status and internal notes inline, and prev/next to walk the filtered set without losing your place.

**Editing behind the update permission.** Admins with update rights can correct submitted values with inputs typed per field; every edit is stamped ("Edited … — the values above are not necessarily what the visitor sent"). There is deliberately no "New Submission" button — submissions are machine-created, and collections can now declare `admin.disableCreate` to say so.

**Spam is a tab, not a black hole.** The Spam tab lists flagged submissions with the detection reason and a "Not spam" recovery (row action or the drawer's status control). Spam stays out of the other tabs and out of exports by default.

**Export from the toolbar.** CSV (columns from the selected form's fields) and JSON, respecting the active form and status filter.

The old `SubmissionsFilter` widget — with its hardcoded slugs that broke under slug overrides — is deleted along with its page registration and the now-empty styles export; host apps no longer import any form-builder CSS.
