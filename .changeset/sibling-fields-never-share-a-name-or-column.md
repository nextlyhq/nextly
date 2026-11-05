---
"nextly": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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

One rule now judges sibling fields wherever a definition is written: `nextly.config.ts` at start, on a config reload and in `nextly db:sync`, the Visual Schema Builder, the REST schema endpoints, the collection and field-group services, `nextly migrate:check` and `nextly migrate:create`. Two fields directly inside one container (the top level, one group, one repeater, or a field group's own top level) may not have the same name, names that differ only in letter case, or names that become one column (`fooBar` and `foo_bar`, `Title` and `title`). Before, the Builder compared only top-level names spelled alike, configuration compared each level ignoring case, and neither compared columns at every level.

- A change that would create such a pair is refused before anything is written, naming the entity, the container and both fields. Fields of one name in different containers are accepted.
- An entity that already holds such a pair keeps being served, saved and migrated as it is, and `nextly migrate:check` warns once for each pair, naming the column or key the two share and saying to rename one.
