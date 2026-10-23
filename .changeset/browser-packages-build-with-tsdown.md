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

`@nextlyhq/admin`, `@nextlyhq/ui` and `@nextlyhq/builder` build with tsdown, which completes the move from tsup. What they publish is unchanged: the same entry points, exports conditions and declarations. The plugin template that `create-nextly-app` scaffolds now builds with tsdown too, through a `tsdown.config.ts` in place of the tsup config. A plugin project now declares `engines.node` as `^22.18.0 || ^24.11.0 || >=26.0.0`, where both tsdown and Vitest run, and `create-nextly-app --template plugin` refuses to scaffold on an older Node, with a message naming the floor.
