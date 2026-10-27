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

**Next.js 15 and React 18 are no longer supported.** Nextly now supports only Next.js 16.4.1 or later within 16.x, and React and React DOM 19.3.0 or later within 19.x, and every package that names them accepts exactly `next ^16.4.1` and `react`/`react-dom ^19.3.0`.

To upgrade an app before updating Nextly:

- Next.js: `npx @next/codemod@latest upgrade 16.4.2`
- React: `npm install react@^19.3.0 react-dom@^19.3.0` (or your package manager's equivalent)

`create-nextly-app` now writes `next`, `eslint-config-next`, `react` and `react-dom` at the reviewed minor (`~16.4.2`, `~19.3.1`) rather than npm's latest release, and stops before changing an existing app whose installed Next.js, React or React DOM is outside these ranges, naming the installed version and what to change.
