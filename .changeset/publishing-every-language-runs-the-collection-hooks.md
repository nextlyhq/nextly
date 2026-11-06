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

Publishing or unpublishing every language of an entry at once (`publish-all` and `unpublish-all`) now runs the collection's hooks, as a status change of one language does: `beforeOperation`, `beforeUpdate`, `beforeValidate`, `beforeChange`, `afterUpdate` and `afterChange`, code-defined, plugin and admin-configured alike, each once per write (where a publish puts pending changes live, `afterUpdate` and `afterChange` run once for each language whose change went live, as before). A `before*` hook that throws refuses the whole write: no language changes, and the caller gets the hook's error. The `after*` hooks run once the change is saved, so one that throws does not undo it. A plugin guard that refuses to take a page builder Layout down, the site's default included, now refuses these routes too. A hook that removes `status` or sets another one has the write refused with a 409, since the write moves statuses and nothing else; for the same reason a field's own `afterChange` hook does not run, as no field changed.
