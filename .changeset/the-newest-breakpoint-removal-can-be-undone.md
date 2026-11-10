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

The newest confirmed breakpoint removal can now be undone, once, within 30 days: `POST /site/breakpoints/removal/undo` with its `runId`, under the site permission its save asked for. The removed breakpoints are put back into the set as it is now (refused, with nothing changed, when one is a breakpoint again, would end at the width of another on its axis, or its axis is full), the shared styles get their values back, and every document the removal kept something for gets its values back where nothing has been set since. A value changed since stays as the author left it, a block deleted since is skipped, and once the undo has finished it answers, per document, how many values could not go back and why (`changed`, `block-deleted`, `gone`, `draft-gone` or `unreadable`). A refused undo says why in plain words, and past its 30 days names the day they ended. Locked blocks and locked shared styles take exactly that restore. The undo is audited (`breakpoint-removal-undone`), and its walk is carried on through the removal route and the removal job like a removal's. Existing installs apply the new `undoes` column and an index on the kept rows with `nextly migrate` before deploying (the page builder's schema version is now 8).
