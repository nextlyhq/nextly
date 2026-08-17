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
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

fix(tsconfig): give each package its own incremental build info

`tsBuildInfoFile` was declared as a plain relative path in the shared base
config, and a relative path there resolves against the file that declares it —
not against the config extending it. Every package in the workspace therefore
wrote its TypeScript incremental state to one shared file inside
`packages/tsconfig`, each `tsc` run overwriting the last, so the state a package
read back always described a different program. Turbo runs these in parallel,
so they also raced to write it.

The same path put the file outside every package's own directory, so turbo's
package-scoped `outputs` matched nothing and 21 packages logged
`no output files found for task <pkg>#check-types` on every run.

`${configDir}` resolves to the directory of the extending config, which is what
was meant. Removing the option instead is not available: tsup's dts step drives
tsc through flags rather than a config file, where `--incremental` without an
explicit `--tsBuildInfoFile` is TS5074 and fails the build.
