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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

An editor can ask what one component instance currently shows for each property
its definition exposes, through `instanceExposure`.

It answers with the value in force and WHICH layer supplied it — the definition
itself, a variant preset, or the instance's own override — because those need
different offers: resetting a value the author never set is not a reset. The
answer separates a deliberately cleared property from one the definition simply
leaves empty, which render identically and are not the same edit, and it reports
overrides whose exposed property has since been removed rather than dropping
them silently.

Derived from the precedence the resolver already applies rather than computed
beside it, so a renderer and an editor cannot disagree about what is in force.
