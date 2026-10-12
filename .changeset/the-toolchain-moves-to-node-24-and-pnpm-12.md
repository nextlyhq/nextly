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

The development toolchain moves to Node 24.21.0 and pnpm 12.5.1. Nothing
about the published packages changes: `engines.node` still reads
`^20.19.0 || ^22.12.0 || >=24.0.0`, so Node 20 and 22 remain supported, and the
version legs `package-smoke` derives from that range still test their floors.
What moved is what contributors and CI run.

The pnpm upgrade is the part with teeth, because modern pnpm reads its settings
from one place and silently ignores the others. The `pnpm.overrides` block in
`package.json` and `link-workspace-packages` in `.npmrc` were both being read
by pnpm 9 and would both have been dropped without a word — the overrides are
security floors, so losing them would have been quiet rather than loud. They now
live in `pnpm-workspace.yaml` as `overrides` and `linkWorkspacePackages`,
entry for entry, alongside an `allowBuilds` allowlist that replaces the
`onlyBuiltDependencies` spelling pnpm deprecated.

Two dependencies the root had been getting by accident are now declared. pnpm 9
linked `@nextlyhq/eslint-config` and `@nextlyhq/prettier-config` into the
workspace root even though nothing asked for them; pnpm 10 stopped, and the root
`eslint.config.mjs` — which imports the first — could no longer be loaded, so
every package without its own config failed to lint. `typescript-eslint` was
reaching the plugin template the same way. A dependency that resolves because of
a hoisting accident is a dependency that disappears without its manifest ever
changing, which is what happened here.
