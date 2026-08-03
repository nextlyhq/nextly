---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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

Custom CSS in the page builder can no longer end the `<style>` element it is
rendered into. A value written with a CSS escape, such as
`content: "\3c /style>"`, contains no markup as authored but was decoded into
markup when the stylesheet was serialized, and on a server-rendered page the
browser then parsed whatever followed it as HTML. Those sequences are now
escaped on the way out, so they still mean the same thing to CSS and nothing to
the HTML parser.

Custom CSS also keeps its meaning inside `:not()`, `:is()`, `:where()` and
`:has()`. Scoping used to rewrite the selectors held by those, so
`.a:has(> .b)` silently became "has a `.b` anywhere under the page root".
