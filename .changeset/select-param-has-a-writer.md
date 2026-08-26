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

The `select` query parameter now does what the documentation says, and a request it cannot read is refused rather than answered with every field.

The REST reference documents one spelling — `?select=id,title,publishedAt` — and it has never worked. The reader accepted a JSON object and nothing else, so the documented request was parsed as nothing, discarded, and answered with the whole document. A caller following the documentation got a response that looked correct and carried every field of every row; the admin's API Playground had to probe a running server to find the form that does work, and recorded the answer in a comment.

Both spellings are now accepted, and both are documented. `?select=id,title` and `?select={"id":true,"title":true}` do the same thing.

Anything the reader still cannot understand is a 400 naming the format, instead of a response carrying every field. That covers the shapes that used to pass silently: an array, a truncated fragment, a map whose values are not booleans, and a map naming no fields at all — including `{"title":false}`, which counted as a projection, selected nothing, and was therefore answered with everything, the opposite of what its author meant.

`nextly/query` exports `encodeSelectParam` and `readSelectParam`, so a caller writes the parameter with the same code the server reads it with. It is a leaf entry point rather than a root export: the admin's API Playground and plugin admin components import it from the browser, and the root entry would bring the server graph with it.
