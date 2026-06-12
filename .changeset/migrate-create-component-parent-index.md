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

Fix `nextly migrate:create` omitting the component parent index, which broke `migrate:resolve --applied`.

The apply pipeline always creates a composite index (`idx_<table>_parent` on `_parent_id`, `_parent_table`, `_parent_field`) for component tables, but the migration-snapshot builder did not emit it. So the live index looked like an unmanaged extra and `nextly migrate:resolve --applied` failed verification ("Live schema does not match the target snapshot") for any project with a component. The snapshot builder now emits the parent index, matching the apply pipeline.
