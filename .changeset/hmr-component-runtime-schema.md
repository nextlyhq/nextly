---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/ui": patch
---

Fix component CRUD breaking with a 500 after a dev-server config hot-reload.

`reloadNextlyConfig` rebuilt the runtime Drizzle descriptors for `comp_*` data tables with the collection/single `generateRuntimeSchema`, which prepends `id`/`title`/`slug` base columns and omits the `_parent_id`/`_parent_table`/`_parent_field`/`_order` link columns that components use to reference their parent document. This overwrote the correct boot-time registration.

After a hot-reload the bad descriptor no longer matched the physical table, so component reads (which filter by `_parent_id`) failed and were swallowed as "no rows", and component writes (which insert the `_parent_*` columns) were rejected by the database. Saving any Single or Collection document that embeds a component returned a 500.

The reload path now builds `comp_*` descriptors with `ComponentSchemaService.generateRuntimeSchema`, matching the boot path and the physical `comp_*` table. Adds a regression test asserting the refreshed descriptor exposes the `_parent_*` link columns and not `title`/`slug`.
