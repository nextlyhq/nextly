---
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

A release's run now handles a document write refused because of a Builder save.

- **A write refused for a moment is tried again in the same pass.** When a release's write is refused because its collection is being changed (`COLLECTION_BEING_CHANGED`) or the database is busy (`DATABASE_BUSY`, or a busy driver error on SQLite), the run tries it again up to 3 times, waiting 250 ms and then 500 ms, never past the pass's deadline. A write still refused after that is a failed write the next pass tries again, as before. The same on PostgreSQL, MySQL and SQLite.
- **A write refused over a field a Builder save changed stops the release, naming the field.** The run stops the release instead of trying it every pass when a write is refused:
  - with a validation issue at `fields.<name>` coded `FIELD_REMOVED` (the field was removed) or `FIELD_CHANGED` (its type or storage changed);
  - or with `BUILDER_SAVE_FIELD_UNSETTLED` (a Builder save left part-way changed it).
- **The stop's reason and field are kept on the member.** Three new nullable columns on `nextly_release_members`, `stop_reason`, `stop_field` and `stop_revision`, hold them. They are added by `nextly migrate` and at boot on every dialect, and no row is rewritten. A stop counts only for the release as it was stopped: scheduling the release again leaves it behind, with nothing to clear.
- **Reading a stopped release's field stops.**
  - The Direct API's `releases.fieldStopsOf({ releaseIds })` answers each release's stops (`FIELD_REMOVED`, `FIELD_CHANGED`, `FIELD_UNSETTLED`), with the document, the field, and how many are on documents the caller may not read.
  - The REST release list and a release's own read carry them as `fieldStops` on a stopped release.
  - A field stop is not a blocker. It does not refuse scheduling the release again, which is what settles it.
- **The admin names the field.** A stopped release's page, its row under Needs attention and its board card say which field stopped it and what to do: start dev or save the collection in the Builder, then run the release again. A release request refused because a collection is being changed now reads "A collection in this release is being changed in the Builder. Try again in a moment."
