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
---

Page-builder node classes come from the engine's digest, not a second one.

The compiler had its own 32-bit hash emitting the same `nx-pb-` prefix the
engine emits from a wider one, so a node could be named two ways, and the narrow
digest carried a real chance of two nodes on a large page sharing a class and
each other's styles. It now uses the engine's 53-bit digest and its collision
handling: one map is built per document and used by the stylesheet, the rendered
markup and the editor preview alike, so a collision resolves to two classes
rather than one node wearing another's styles.

Every generated node class and per-document scope class therefore changes value.
They are compiler-generated and recomputed on every render, so nothing stored
refers to them, but a host that hardcoded one in its own CSS should re-read it.
