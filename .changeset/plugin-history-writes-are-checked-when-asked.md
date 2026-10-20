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

A plugin's history writes are checked when it says who it acts for.

`ctx.services.versions`' `setLabel`, `deleteWorkingDraft` and `autosave` take a new, optional trailing `ServiceOpts`. Existing calls, which pass none, are unchanged and stay trusted, as does `{ as: "system" }`. A write made as a person (`{ user }` or `{ as: "user", user }`) is judged as the REST history routes judge that person: it needs `update-<collection>` (or the Single's), then the document must be one they can read, refused as not found when it is not, and one they may update. An autosave also needs the entity's autosave to be on. `{ as: "public" }` and a plugin-defined person are refused as unauthenticated.

On a checked write the person is the author, as on REST. Naming a version with no `by` records them as the one who named it, and an autosave with no `createdBy` is filed under them. A `by` or `createdBy` naming anyone else is refused, and nothing is written. A page's history has no REST write to be judged as, so a checked write to it is refused.

Every plugin autosave, checked or trusted, is now stored the way REST's autosave stores one: without password values, and refused when the fields that say which values are passwords cannot be read. The snapshot the plugin passes is not changed.
