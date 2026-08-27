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

Give the literal and digested preview-container names disjoint namespaces.

`previewContainerFor` carries a seed literally when the identifier reduction
loses nothing and digests it otherwise, but both constructions shared one
prefix — so a surface seeded with another surface's digest was carried
literally onto the same name. Two unrelated boxes received one container, which
is the collision the per-surface factory exists to prevent.

Marking only one path would have moved the ambiguity rather than closing it,
since a literal seed can begin with whatever single mark the digest uses. Both
now carry a mark at a fixed offset, so no pair of inputs can meet.
