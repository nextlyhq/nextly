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
---

Retention never removes a version a feature has pinned. A feature registers
itself as a pin holder once, then points named slots at versions of a document
(`versionPins.holder(name).pin(tx, { ref, slot, versionNo })`); moving a slot
frees the version it left, and a version stays while any slot of any feature
points at it. `registerVersionPinHolder`, `versionPins` and their types are
exported from `nextly` as experimental, and the versions docs describe them.
Pins are kept in a new core table, `nextly_version_pins`, which `nextly
migrate` creates on an existing database, and they go with their document or
Single when either is deleted. A pin takes the document's write lock, so it
cannot slip past a save's retention pass.
