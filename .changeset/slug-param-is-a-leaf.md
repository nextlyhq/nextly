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

`slugToStaticParam` turns a stored slug into the path segments a route serves.
Anything that emits a URL for an entry has to agree with the route about that —
a sitemap, a canonical, a link between entries — so the SEO plugin and the blocks
renderer both call it rather than re-deriving the rule.

It was defined inside the content route's module, so an application build that
bundles rather than externalises `nextly` acquired that whole module graph to get
one pure string function: the Direct API, the error type, the not-found trigger
and the content resolver. Measured with esbuild against the source, importing the
function pulled **1042 modules and 18.4 MB**; from its own module it pulls **2
modules and 1.4 KB**.

It now lives in a leaf module that imports only the reserved-path check, with a
test asserting that its whole transitive import graph stays exactly that. Every
published spelling — `nextly/runtime`, `@nextlyhq/plugin-sdk/routing`, and the
route module itself — still exports the same function, and a test asserts they
are one function rather than three that agree today.

Its published documentation was also wrong: the generated types carried a
paragraph about Direct API access defaults, left behind by an unrelated change,
in place of any description of what the function does.
