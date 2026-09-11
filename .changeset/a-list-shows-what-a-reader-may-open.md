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

The collections and singles listings show exactly what the reader may open.

Both lists scoped themselves by the stored `{slug}:read` grants alone, while
every other read -- opening a document, the dashboard's own scope, a version
read -- also consults the entity's code-defined `access.read`. The two
disagreed in both directions: a collection or Single authorised entirely in
code has no grant row, so it was left out of the list a reader could open it
from, and on the dashboard the singles card was offered for it and then drew
nothing; a grant the code rule refuses was listed anyway.

Both listings now take the same read decision as everything else. One
consequence for API keys: a key owned by a super admin no longer lists every
collection and Single. It is judged on its own stamped scope, which is the rule
every other read path already applied to it.
