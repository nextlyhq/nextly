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

Removing a Design variable or a shared style no longer waits for someone to press Count now on a site no scheduler drains. Where the page builder's usage index has not counted every page, the removal counts them first, for up to 5 seconds, and then judges: an unused variable is removed, a used one is refused as in use, and a site too large to count in that time is told the pages are still being counted, to try again shortly or use Count now. Two removals at once in one process share one count.

Plugins get an `@experimental` `onMigrate(ctx, { applied })` hook, which `nextly migrate` and `nextly migrate:fresh` call for each enabled, installed plugin once a run leaves nothing pending, after the schema and access steps. It runs after migrate's lock is released, never at boot, in a dry run, or when `--step` leaves migrations pending; a hook that throws makes the command exit non-zero while the applied schema stays applied. The page builder uses it to count the site's pages into its usage index (for up to 60 seconds), so a deployed site starts counted. The boot `nextly plugins install` and `uninstall` make for `onInstall` and `onUninstall` is now shared with it.
