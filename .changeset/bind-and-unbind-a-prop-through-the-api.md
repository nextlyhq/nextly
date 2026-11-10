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

A block's prop can be bound to a field, and unbound, through the page actions API: `bind-prop` and `unbind-prop` on `POST /pages/actions`, each with a dry run, judged as an editor save is. An unbind keeps what a visitor sees now, read on the server from the published page with the public's access: never a pending draft's value, nor a field visitors can't read, for which the fallback or the prop's own value is kept instead. A template's and a list item's value is kept once the entry or item is named, and a value can be given. An image a visitor saw by its address is kept in the block's declared address prop (`addressProp`, `src` on the Image block). The answer says what was kept and why.
