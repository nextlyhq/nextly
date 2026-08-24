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

Colour code in the admin from the theme's own palette instead of CodeMirror's
bundled one. API Playground responses, generated snippets, request bodies, code
fields and email templates all read `--nx-code-*`, so they follow a retheme,
match the rich-text editor's code blocks, and come under the contrast audit
that already covers those tokens. One style now serves both modes, because the
tokens are redeclared under `.dark` — light and dark no longer drift apart.

Code also renders in the admin's own mono face rather than a hardcoded stack,
and a bracket under the caret keeps its highlight instead of losing its colour.
