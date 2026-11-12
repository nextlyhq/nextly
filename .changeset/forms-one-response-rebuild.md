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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

Changing a form's one-response setting now counts its earlier submissions. Keys carry the form's one-response version, which a change of mode or Email field moves on, so earlier keys stop matching at once. A form with up to `oneResponse.keysInSave` submissions (default 200) gets keys for the new version inside the save; a larger one is finished by a sweep (`form-builder:one-response-keys`), and until then a new submission is compared with the earlier ones directly. The earliest of several with one value keeps it, and when the holder is deleted, marked spam or edited, the next earliest takes it. A key made for a version the form has since left is refused where it is stored. The form editor saves on through a revision moved on only by the plugin's own record that keys are made.
