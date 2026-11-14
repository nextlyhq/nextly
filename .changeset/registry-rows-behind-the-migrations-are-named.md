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

`nextly migrate:status` and the end of `nextly migrate` now name every registry row that differs from the newest applied migration's record of it. That includes a row lacking a field, a row holding a field the record does not, a row whose settings differ, and a row that is missing though the record holds it. Each line says to run `nextly migrate`, which brings the row back. `migrate:status --json` lists them under `registry.behindSnapshot`. A production start also logs each code-first collection or Single whose row lacks a field the build declares, or has no row, with the same advice. It sends no statement for this, since it compares the rows it already reads.

Such rows come from upgrading a site on a serverless host from 0.0.2-alpha.75 or earlier. The previous deployment keeps serving while the new one builds, and a start of that release wrote every registry row from its own configuration. A start of the previous deployment after the new build's `nextly migrate` could therefore leave rows without fields the new build added, such as a plugin's field group. The admin then showed those types without the field, and nothing said why. Running `nextly migrate` once more after the new deployment is live writes the rows again.
