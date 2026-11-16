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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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
"create-nextly-app": patch
"nextly": patch
---

A held draft is kept by language wherever a document keeps values per language.

- Under per-language storage (`experimental.perLanguageStorage`), a Single that is not translated but embeds a translated component holds drafts: each language's edit to the component is held in that language's draft and published to that language's row. Its publish of every language writes each translatable value to that language's row.
- A version of a document that stores a component, at the top level or inside a group or repeater, is recorded under the language the component was read in, even when the component is empty, on every path that records one. A held save of such a document is now found as that language's draft (`?baseline=draft` no longer answers `NO_BASELINE` for it).
- A second held edit of a translated field is kept: it is recorded as a version and is what the draft holds. It was matched against the draft it replaced, found unchanged and dropped.

Behaviour change: without per-language storage, a collection that is not translated but embeds a translated component no longer holds drafts, as a Single like it already did not. Its one draft had no language, so held edits in two languages shared it, and a publish of every language wrote one language's component values into another's row. A status-less save of such a collection now saves live. A draft such a collection already holds stays shown and can be discarded, but it is never published, since it names no language: while it is there, a save, a publish of one language and a publish of every language are refused (409). Copy what you need from it, then discard it.
