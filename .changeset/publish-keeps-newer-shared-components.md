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

Publishing a language's pending change no longer puts back a shared component or a shared many-to-many relation that someone else published after the change began. These are now checked against the change's base like the shared columns: an out-of-date one is named in the 409, and taking the live values brings it up to date. Components are compared by content, so a publish that only rewrote a component's rows doesn't refuse anyone. A component whose values are kept per language is judged by its shared parts: its instances and the sub-fields it marks shared. Publishing every language refuses with the reason `shared-edits-unmergeable` when more than one language is pending and any of them changed such a component's shared parts, since each language's copy would write over the others'; publishing one language at a time settles it.
