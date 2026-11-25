---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

`nextly db:sync --demote` is refused when the collection declares a unique index in `indexes`, which the Schema Builder cannot hold: before, the next schema sync dropped it and duplicates were accepted. A schema hook on a collection handed to the Schema Builder is now judged by the collection's fields in the Builder, not by the ignored code entry, on `db:sync`, a reload and a development start. Where a hook names a field the Builder removed and the code entry still has, `db:sync` and a reload refuse it, and a development start warns and goes on, so a Builder save cannot stop `next dev`; production starts and migrations still follow the entry. A group with no name no longer stops the compile of a schema hook. A collection demoted on an earlier release and not synced since still loses its indexes at its next schema sync or at a Schema Builder save.
