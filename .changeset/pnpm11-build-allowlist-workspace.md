---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/ui": patch
---

Fresh projects scaffolded with `pnpm create nextly-app` no longer fail to install under pnpm 11. pnpm 11 stopped reading the `pnpm` field from `package.json`, so the `pnpm.onlyBuiltDependencies` allowlist the scaffolder emitted was ignored: `pnpm install` aborted with `ERR_PNPM_IGNORED_BUILDS`, and past that `better-sqlite3` never compiled its native binding (SQLite scaffolds crashed at boot) while `sharp`, `esbuild`, and `unrs-resolver` were silently blocked.

The scaffolder now writes the build-script allowlist to `pnpm-workspace.yaml` instead, emitting both `allowBuilds` (read by pnpm 11+) and `onlyBuiltDependencies` (read by pnpm 10.6+), and drops the now-dead `pnpm` field from the generated `package.json`. `better-sqlite3` is always allow-listed so the `--use-yalc` dev flow — which installs every adapter — builds it too. npm, yarn, and pnpm 9 run dependency build scripts by default and ignore the file, so it is harmless under those package managers.
