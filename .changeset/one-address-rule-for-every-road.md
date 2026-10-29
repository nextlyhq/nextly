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

One rule now judges a new collection, Single or field-group address, wherever it is set: `nextly.config.ts`, the Visual Schema Builder, the REST schema endpoints, `nextly.fieldGroups.create()`, `nextly migrate:check` and `nextly migrate:create`. Before, these disagreed: the Builder accepted `admin` and refused `team-updates`, configuration did the reverse, and the collection schema endpoint took any 255-character name.

- A hyphen is accepted everywhere, and the table is named from the snake_case form (`team-updates` is stored in `dc_team_updates`). A second address with the same snake_case form is refused, naming both: among collections and Singles, and among field groups.
- Every road refuses a route or system table Nextly uses (`admin`, `accounts` and others), a system resource for a collection or Single, a reserved SQL word, and an address whose tables would pass the 63-character name limit. New limits for new addresses: 48 characters for a Single and 47 for a field group.
- An entity that already exists under an address the rule now refuses keeps working, and `nextly migrate:check` warns about it once. The Direct API's `fieldGroups.update()` no longer re-judges a field group's existing address.
