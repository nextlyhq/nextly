---
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/plugin-mcp": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

The page builder's top bar now ends the way the entry's header does. After the buttons that show or hide each side panel come the save state, **Preview** with its word, and the leading action (**Publish**, **Publish changes** or **Save**), whose arrow holds **Save draft**, **Schedule publish…** and **Unpublish**. The save state is the header's own: **Saving…**, **Unsaved changes**, **Saved** with when in its tooltip, or **Not saved** with **Retry**, announced to screen readers the same way. It replaces the "Unsaved changes" chip beside the title. An action that can't run is disabled and says why. Duplicating, discarding and deleting stay on the entry's page. The device buttons and the rail's items now show the admin's focus ring, which stays visible on the selected one.

`@nextlyhq/plugin-sdk/admin` adds `DocumentSaveIndicator` and `DocumentPrimaryAction` (experimental): the header's save state and leading action, drawn by the admin for a document view that replaces the header. A document view now also sees the document's recovery point, so edits held only in one read as unsaved wherever the save state is shown.
