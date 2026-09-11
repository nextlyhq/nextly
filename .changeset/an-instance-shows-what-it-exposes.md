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

Selecting a component instance in the builder now opens its own inspector in
place of the block tabs: the component's title (and how many pages use it, once
the library carries that count), then one row per exposed property showing the
value in force, where it came from (inherited,
from a variant, overridden, or cleared), and a visible Reset on every override the instance itself holds.
Text and choice properties are edited in place; rich text, image, link and
visibility rows show their value and say they are not editable here yet. An
emptied text field clears the property rather than writing an empty string, a
row another exposure shadows names the one the page shows, and values stored
for properties the component no longer exposes are listed with a Discard rather
than dropped. The block inspector's name and lock fields now come from one
shared module, as does the draft-follows-the-document behaviour of every text
field.

The blocks engine now publishes `readableDefinition`, the rule the resolver
applies to a supplied component definition before inlining it, so the inspector
refuses exactly what the canvas refuses: a definition in another format, or one
whose nodes are not a list, draws no editable row.
