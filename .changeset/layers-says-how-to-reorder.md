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

The layers panel says how to reorder a block.

Moving and nesting a block with the keyboard already worked while the layers panel had focus, but nothing said so, and a capability nobody can find reads exactly like a missing one. The panel now shows the keystrokes under the tree, and screen readers hear them on entering the tree rather than only if they reach the text below it.

The keystrokes are spelled for the keyboard in front of the author — Option on a Mac, Alt elsewhere — and they are read from the bindings the editor actually registers, so a rebound key changes the hint with it instead of leaving a label that teaches a keystroke which does nothing.
