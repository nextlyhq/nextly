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

Adding Nextly to an existing app no longer replaces or refuses over files the app already has, and the run ends with one report of everything it did. Before, a `nextly.config.ts`, admin API route or admin page already there stopped the whole run with an error, and the admin's `layout.tsx` was written over whatever the app had.

Now every file is created only where nothing is (exclusively, so a link or a file that appears meanwhile is never replaced). One already there is left byte for byte, and the report says so, with why and, for the admin's routes, page and layout, the content Nextly needs there. The report lists each file written, each extended with what was added (the Next config's packages included), and each left alone, across every step, the env files and their warnings included, in one place after the spinner, by path, key and package name only: no env value, the generated secret included, is ever printed.
