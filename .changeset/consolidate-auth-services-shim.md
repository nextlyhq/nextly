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

Internal refactor: consolidate the `packages/nextly/src/services/auth/` shim layer. The shim was a directory of one-line `export *` re-exports left over from an earlier reorganisation; the canonical code already lived in `packages/nextly/src/domains/auth/services/`. The shim directory has been removed and 29 internal call sites have been pointed at the canonical location. A duplicate test suite of 13 files (mechanical-path-only drift, no logic divergence) has been deleted in favour of the existing copies under `domains/auth/__tests__/`. A new `@nextly/domains/*` TypeScript path alias is added to match the existing `@nextly/services/*` / `@nextly/auth/*` pattern. No public exports, runtime behaviour, or wire-format changes; this is shipped as a patch because every package version moves together in the alpha train.
