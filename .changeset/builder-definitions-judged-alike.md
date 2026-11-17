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

`nextly migrate:check` and `nextly migrate:create` now read the Schema Builder's definition file (`db.uiSchemaFile`, `./ui-schema.json` by default) by one set of rules. A relationship whose target neither file declares is refused by both with `BUILDER_RELATION_TARGET_UNKNOWN`, where `migrate:create` used to write it into a migration. When the newest migration snapshot records a Builder collection, Single or field group that neither `nextly.config.ts` nor the definition file declares, both refuse with the new `BUILDER_DEFINITION_MISSING`, naming each entity and the file, instead of planning a drop of its table; a Builder delete, which writes its own migration, is unaffected. A Builder entry whose slug a code-first entity of the same kind uses is warned about by both, naming its kind (collection, Single or field group). The scaffold never ignored the file, and the docs say to commit it. Compatibility: `nextly migrate:check` no longer fails with `BUILDER_SLUG_COLLISION` on such a pair; it warns, as `migrate:create` does, and the code is retired. A Builder entry named like a code-first collection but of another kind (a Single or field group) is no longer reported at all, since each kind keeps its own table. A project whose definition file is not committed now sees both commands refuse until it is restored.
