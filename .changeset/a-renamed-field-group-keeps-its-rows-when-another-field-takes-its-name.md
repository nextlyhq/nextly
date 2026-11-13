---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
"nextly": patch
---

A field group renamed while another field takes its old name now keeps its stored values. When a site renames its own `seo` field group to `legacySeo` and adds the SEO plugin, whose `seo` group lands on the same types, in one change, `nextly migrate:create` now offers the rename (and `--accept-renames` accepts it), so the migration moves the group's rows to `legacySeo` and moves them back in its down step. Before, the old name still being in use hid the rename: the rows stayed under `seo`, where nothing reads them, and `legacySeo` read empty. A field group that changes which groups it holds, or whether it repeats, under the same name now counts as removed and added in the same way, in the Schema Builder too, so another field group renamed in the same save can take its rows.
