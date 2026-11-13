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

The SEO Overview matches its design: the verdict on Search health has a dot in its colour and the error, warning and notice counts are written in their colours rather than as chips; Search health and Pages lead with a smaller figure; the setup steps sit in two columns with done steps crossed off.

Plugin pages can draw these too (experimental, through `@nextlyhq/plugin-sdk/admin`): `Stat` takes `tone` (`success`, `warning`, `destructive` or `info`) and `size="compact"`, and `Checklist` takes `columns={2}` and `doneStyle="struck"`. Without them both draw as before, so the dashboard's setup card is unchanged.

A plugin's own sidebar panel no longer repeats the plugin's name as a small heading under the panel's title; the menu is still named by it for screen readers.
