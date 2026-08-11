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

The root entry now re-exports the engine types the surface is built from, and
the set is CLOSED: an exported type is only as writable as its parts, so a host
handed `BlockDefinition` could name it and still not write down the `supports`
object it must pass or the `seo()` contribution it must return. Everything
reachable from a re-exported type is re-exported too, so annotating any part of
the surface needs no second package.

They live on the root entry rather than `/next`, whose declarations import the
`next` and `nextly` peers a standalone install does not have.

A regression test asserts each is named in an EXPORT STATEMENT of the built
`.d.ts`, not merely present in the file, and derives what is required from the
declarations themselves — the entries from `package.json`, the obligation from
the engine's own composition — so the check grows with the API rather than with
someone remembering to extend a list.

`nextly`'s own route types are deliberately not re-exported: it is a peer
dependency, so a host names `ContentEntry`, `RenderContext` and the route shapes
from `nextly/runtime` where they live.
