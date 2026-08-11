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

`@nextlyhq/blocks-react` now exports the types its public API is written in.

`StyleCompileContext`, `BlockDocument` and `DocumentLimits` appeared in the built
declarations in parameter positions while being named in no export statement,
and `BreakpointSet` — the one field `StyleCompileContext` requires — was absent
from the surface entirely. A host could see the name it was required to pass and
had no way to write it down, because those types originate in
`@nextlyhq/blocks-engine`, which is a dependency of this package rather than a
peer.

The root entry now re-exports the engine document, style and breakpoint types;
the `/next` entry re-exports `BlockSeoContribution` and `BlockSeoImage`. A
regression test asserts each is named in an EXPORT STATEMENT of the built
`.d.ts`, not merely present in the file.

`nextly`'s own route types are deliberately not re-exported: it is a peer
dependency, so a host names `ContentEntry`, `RenderContext` and the route shapes
from `nextly/runtime` where they live.
