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

A read against a collection that does not exist answers "not found" again, instead of a server error.

Both halves of the collection access check decided whether an error meant "this collection does not exist" by looking for the words "not found" in its message. The error the registry actually raises carries the text "Not found.", so neither comparison ever matched the one error it was written for — a genuinely missing collection produced a 500 from the permission gate, and, since a recent change, a rejected read from the constraint resolver. Both now ask the error what it is rather than reading its prose, so the case they were written for is the case they catch, and an unrelated failure whose wording happens to contain those words no longer takes the exit.
