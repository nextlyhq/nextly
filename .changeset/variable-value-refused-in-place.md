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

A Design variable's value is checked where it is typed. A value the save would refuse, such as `12pxred` in a size or `#12345` in a colour, is refused in its own field with the reason and what to type instead, before anything is sent, and a bare number in a size, spacing or radius gets `px`. The kind check behind it, now exported from `@nextlyhq/blocks-engine` as `checkTokenKind` with `tokenKindExample`, also refuses words in a length variable (other than the keywords a property reading it takes, such as `auto`) and a malformed hex in a colour; a function it does not know still passes. Its warning no longer says a refused value "was written as given": that consequence is now the issue's `suggestion`. If the server still refuses a variable, only that variable is taken back and the rest of the change is saved, and a refusal of a value no longer stops the page from being saved; a save that fails on the network still does. A new variable on a site whose pages are not counted yet is removed in one step, with the save deciding, and its status says "Not counted yet". A new variable's code name follows its name however the name field is left, and search matches only the name shown. On a failed save, Details opens on click.
