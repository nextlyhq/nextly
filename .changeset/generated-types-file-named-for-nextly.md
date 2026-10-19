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

The generated types file Nextly writes when `typescript.outputFile` is not set is now `src/types/generated/nextly-types.ts`, named for Nextly, instead of `payload-types.ts`. The CLI help names it.

If your config doesn't set `typescript.outputFile` and still has the `payload-types.ts` an earlier version generated, `nextly generate:types`, `nextly build` and `nextly db:sync --types` write `nextly-types.ts` and turn `payload-types.ts` into a one-line re-export of it. Existing imports keep compiling, and only one file declares the generated types, which TypeScript needs. The command tells you when it does this. Change imports of `payload-types` to `nextly-types`, then delete the old file; a later release stops keeping it. A `payload-types.ts` that Nextly did not generate is left as it is, with a warning. To keep the old name, set `typescript.outputFile` to it.
