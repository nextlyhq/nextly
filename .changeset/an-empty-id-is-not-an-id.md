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

The block renderer now asks the engine which HTML `id` a block emits instead of deciding again. `renderedDomId` was already the one rule for that question — validation, the planners, the copier, the resolver, the tree walker and the builder all derive from it — and the renderer, the thing that rule models, was the last place keeping its own copy.

One rendered-output change comes with it: a block whose id is set to an EMPTY STRING no longer emits `id=""`. It emits no `id` attribute at all. Nothing addressable is lost — the DOM Standard unsets an element's ID when the attribute is the empty string, so `getElementById("")` never matched it and no `aria-labelledby`, `for` or `#` selector could reach it, while the HTML Standard requires an id to hold at least one character. What shipped before was invalid markup that addressed nothing.

An empty id still SHADOWS an `id` in the block's attributes, which is the part authors can observe, and the inspector still offers to remove it. Its note now says the block renders no id at all and that the attribute id is ignored, rather than describing the `id=""` that no longer appears.
