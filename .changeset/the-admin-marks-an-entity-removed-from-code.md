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

The admin now marks a collection or Single removed from code. While its registry row says your code defines it and `nextly.config.ts` no longer declares it, it stays in the Content navigation, the Singles list and its own screens with a "Removed" mark, and its list and edit screens show a notice naming it, saying it is no longer in the configuration, and giving the next step for where its retirement stands: `nextly migrate:create` and then `nextly migrate` while its tables exist and no migration drops it; `nextly migrate`, naming the file, while a written migration that drops it is not yet applied; and, where an applied migration dropped its main table but its registry row remains, that an earlier release left it part-retired and that `nextly prune` lists what remains. Its entries can still be read, and the admin offers nothing that would change them: no New, Save, Publish, Unpublish, Delete, Duplicate, bulk action, restore or version naming. Publishing every language at once is held as well, and a write the server refuses because the entity was removed from code, such as one sent from a screen opened before the removal, now shows the server's own sentence on every path, publishing every language and discarding a pending change included, and turns that screen read-only without a reload. The collection and Single listings and schema reads (`GET /api/collections`, `/api/collections/{slug}`, `/api/singles`, `/api/singles/{slug}/schema`) add `removedFromCode: true` and `removedFromCodeState` to such an entity; every other entity's response is unchanged. Schema Builder and plugin collections and Singles are never marked.

**Compatibility:** a site that still edits a collection or Single removed from code is refused from this release, in the admin as in every other entry point. There are two ways out: declare it again in `nextly.config.ts` to keep it, or retire it by running `nextly migrate:create` and then `nextly migrate`.

**Databases already half-retired:** an earlier release could apply a migration that dropped a removed collection's or Single's table and leave its registry row behind, which `nextly migrate` does not yet clean up. The admin now reports such an entity as part-retired. Until that clean-up is automated, check for one with `nextly migrate:status`, which names a registry row whose table does not exist, and, after taking a backup, remove what remains by hand: its row in `dynamic_collections` or `dynamic_singles`, and the rows that name it in the field-group, translation-archive, version and autosave tables.
