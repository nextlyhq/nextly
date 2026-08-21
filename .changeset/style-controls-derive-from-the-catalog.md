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

The page builder gains the contract its style controls will be built on. Which controls a style
property offers is now derived from the engine's own catalog rather than listed anywhere, so a
property added to the catalog gains an editor with no control code written; a leaf kind the
catalog grows that this build has no control for appears as a known gap instead of vanishing.
Reading and writing a control's value goes through one address — state, breakpoint, property and
the path inside it — so nothing spells that path a second time, and every value is checked by the
catalog's own validator rather than by a control's idea of it. Dragging a value previews it by
compiling the same declarations the published stylesheet carries, so a token still resolves to the
custom property it resolves to on the page and a value the compiler would refuse never reaches the
screen; releasing writes one operation, which is one step of undo. Whether a value was authored
here, inherited from a class or never set is read from the record the compiler already writes, so
a control cannot disagree with the page about where a value came from. No controls render yet.
