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

Add the tokens studio to the page builder's left rail. A site's design tokens —
colours, sizes, fonts, weights, numbers, shadows, durations and custom values —
are listed by kind and edited where they are read, with light and dark values
behind one switch. Renaming a token moves only its label: references key on an
identity the rename freezes, so every block already pointing at the token goes
on resolving and no stored document is rewritten. The engine's own verdict is
shown per row, so a value that contradicts its kind, one that would make the
page fetch a file, and two tokens that would collide on one custom property are
each reported where they are edited rather than discovered on the canvas.
