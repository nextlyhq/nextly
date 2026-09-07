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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Version the `fast-uri` bump, which reaches published output rather than only
this repository's tooling.

`@nextlyhq/telemetry` bundles every one of its dependencies into its build
(`noExternal` matches everything), so `conf` -> `ajv` -> `fast-uri` is inlined
into the emitted file rather than resolved by a consumer, and that file is
incorporated into the published `nextly` and `create-nextly-app` CLIs. Raising
the override floor from `^3.1.5` to `^3.1.6` therefore changed what those
artifacts contain: 3.1.7 replaces a 3.1.5 carrying four advisories, the highest
being server-side request forgery through malformed IPv6 normalization and host
confusion through skipped IDN canonicalization on scheme-relative references.

The telemetry client validates its own configuration schema and never parses a
URI a user supplies, so this closes no reachable hole. It is a patched release of
code that genuinely ships, which is why it needs a version rather than only a
lockfile entry.
