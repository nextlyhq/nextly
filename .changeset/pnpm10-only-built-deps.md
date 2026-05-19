---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Fresh projects scaffolded with `pnpm create nextly-app` no longer crash at boot under pnpm 10+. pnpm 10 blocks dependency install scripts by default, and without an allowlist `better-sqlite3` never built its native binding, so SQLite scaffolds threw `Could not locate the bindings file` on the first admin request. `sharp`, `esbuild`, and `unrs-resolver` were silently blocked too, producing a slow JS image fallback, drizzle-kit slowness, and an eslint resolver warning respectively. The scaffolder now emits `pnpm.onlyBuiltDependencies` in the generated `package.json`: `sharp`, `esbuild`, and `unrs-resolver` always, plus `better-sqlite3` when the SQLite adapter is selected. npm, yarn, and bun ignore the `pnpm`-namespaced field, so it is harmless under those package managers.
