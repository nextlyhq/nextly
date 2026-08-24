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
"create-nextly-app": patch
"nextly": patch
---

Edit a form's notifications on the page, not in a panel over it.

The editor was a 560px sheet that slid over the form and carried its own
"Save changes" beside the page's own commit, with nothing saying which one
persisted. It also dimmed the page it slid over, so the one thing a panel is
for — keeping the page in view — was not delivered.

Each notification is now a row that expands in place. Edits reach the form as
they are typed, so the page's action bar is the only commit, and address
validation moved from a save press to leaving the field. One row opens at a
time, so the list keeps the overview its summaries exist to give.
