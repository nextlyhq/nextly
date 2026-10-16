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

Adding Nextly to an existing Next.js app now installs everything it needs and finishes, on npm, pnpm, Yarn and Bun. The app gets `esbuild` as its own dev dependency, so `nextly.config.ts` can be read and code-first collections load; before, npm left it nested under another package where Nextly could not find it. The install uses the package manager the app's lockfile names rather than the one that launched the generator, so `npx create-nextly-app` in a pnpm app no longer runs npm over pnpm's install.

On pnpm, the build scripts of the native packages Nextly brings (the SQLite driver, esbuild and sharp) are approved before the install, where the app's pnpm reads them: `allowBuilds` and `onlyBuiltDependencies` in `pnpm-workspace.yaml` from pnpm 10.6, or `pnpm.onlyBuiltDependencies` in `package.json` on pnpm 10.0 to 10.5. pnpm 11 and later refused the install until then, and the generator stopped with no config or routes written. On Bun, an app that keeps its own `trustedDependencies` list, as create-next-app writes one, gets Nextly's packages added to it; with that list Bun skipped the SQLite driver's install script, and the app answered 500. Only Nextly's packages change, a value the app already set is kept, and each change is printed. A project set up this way with an earlier version can add `esbuild` as a dev dependency, and on pnpm or Bun approve these packages with the same keys, then install again.

When an install fails, the generator now names the exact command to run to see why.
