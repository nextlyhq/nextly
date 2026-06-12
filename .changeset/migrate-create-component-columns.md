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

Fix `nextly migrate:create` generating the wrong schema for components.

The migration snapshot generator built component tables with the **collection** table-builder, so they came out with `slug`/`title` and were missing the component embedding columns (`_parent_id`, `_parent_table`, `_parent_field`, `_order`, `_component_type`). The generated snapshot then diverged from the real component table the apply pipeline creates, which made `nextly migrate:resolve --applied` fail its schema-match verification for any project with a component. Components now use `buildDesiredTableFromComponentFields`, matching the apply path.
