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

History opens beside the document. The editor's History control (a row of
the document's menu on a phone) opens it in the document panel's place:
400px wide, or 360px on a window under 1200px wide with the content sidebar
folded while it is open, and as a page of its own under 1024px. The editor
stays as it was, unsaved words and place on the page included. Whether
history is open, and the version chosen in it, are kept in the page's
address (`?history=1&version=N`), so a reload or a shared link opens the same
version and back closes the panel; neither counts as leaving the document.
Showing a version marks it seen for the signed-in person, once each time it
is shown, which is what a comparison since they last looked starts from;
the history list marks nothing. The compare dialog is gone: a comparison is
read on its own page, opened from the version being shown.
