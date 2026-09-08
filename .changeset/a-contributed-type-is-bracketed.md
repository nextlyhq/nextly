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

A generated type contributed by a plugin is bracketed before `| null` is added
to it, and the bracket is placed where a comment cannot reach it.

A plugin's `codegen.tsType` callback returns an arbitrary type expression. Two
shapes bind looser than a union and captured it: a conditional attached the
null to its FALSE branch, leaving the true branch rejecting a value the column
can return, and a function type attached it to the RETURN rather than to the
field.

Bracketing is decided by where the expression came from rather than by
inspecting it, so no formatting of the expression and no type-level syntax
added later can change the answer. The closing bracket sits on its own line
because `//` runs to the end of its line, and an expression ending in a
comment would otherwise swallow it and leave a file that does not compile.
