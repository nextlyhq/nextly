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

The op vocabulary is part of the engine.

`BuilderOp`, `applyOp`, `applyOps`, `OpError`, `positionOf` and the shapes
around them now live in `@nextlyhq/blocks-engine` and are re-exported by
`@nextlyhq/builder` unchanged. Applying an edit is not an editing-surface
concern: a plugin route, a script or an agent has the same right to the
operations the editor applies, and each would otherwise grow its own vocabulary
that agrees with this one only until one of them changed.

Nothing about the operations themselves changed. The relocation is byte for
byte, and the existing suite of 202 operation tests runs unchanged against it
through the builder's re-export — which is the point of leaving those tests
where they are.

They live in the engine's own module rather than beside the reserved operation
names. `format.ts` re-exports those names, and the vocabulary reaches the
registry and the validators, which pull in a glob matcher and a CSS parser. That
entry point exists so a generator or a schema publisher does not load the
validator, the migrations and the style compiler; putting the vocabulary beside
the names would have pulled all of it through, which its boundary test caught.

`@nextlyhq/builder/ops` is unchanged and still published: a server action or an
agent importing it keeps working exactly as before.
