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

Adds an Advanced tab to the page builder's inspector, where a block's `id` and
its own HTML attributes can be set. Both were already modelled and already
applied to the rendered element; until now nothing in the editor could write
them, so an anchor to link to or a `data-` attribute an analytics script reads
had to be added outside the builder.

A row that the page would not render is refused where the author can still see
why, rather than saved and dropped later: an attribute the renderer does not
allow, a second row setting a name another row already sets, and an `id` that
the CSS id field beside it would win over. The rule is the renderer's own and is
asked rather than copied, so the editor cannot come to accept a name the page
then discards.
