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

The entry and single editors get a language panel: one place that says what
state every language is in and carries the actions that follow from it, in the
document rail where there is room and inline where there is not, so the
language workflow can no longer be the surface that disappears at narrow
widths.

Singles can now copy content from another language. The action used to gate on
a collection slug and an entry id, which is how an entry is addressed rather
than anything the action needs, so it was collection-only by accident; both
editors now supply the read themselves and it gates on being able to read a
source.

Switching languages is withheld while a past version is on screen, alongside
the mutations it already withheld, and each language row's controls name the
language they act on.
