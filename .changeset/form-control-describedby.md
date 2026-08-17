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
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

fix(admin): describe a field only when a description renders

`FormControl` named the description element in `aria-describedby`
unconditionally, while `FormDescription` renders nothing when it has no
children. Every field without a description therefore pointed assistive
technology at an element that was never on the page: the admin has 76
`FormControl` usages against 3 `FormDescription`, and 13 of the 14 files using
`FormControl` contain no description at all.

`FormDescription` now registers its presence on the field context and
`FormControl` composes `aria-describedby` from the elements that actually
render. Measured in a browser across eight admin form routes in both themes:
five dangling references before, zero after.
