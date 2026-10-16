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

Document views keep unsaved work in three more cases.

- Moving from a document with unsaved changes to a field-type view it has no
  top-level field for now asks before leaving. That address shows "not found",
  which unmounts the form, and the work was lost without a prompt.
- Leaving a view for its document no longer switches the leave guard off for a
  moment, so a click straight after the exit still asks about unsaved changes.
- Restoring recovered work mounts the view again, so a view that keeps its own
  copy of the document, as the Page Builder does, shows and saves the restored
  work rather than what it held.

Startup also refuses a document view whose `label` is not text, which would
otherwise fail every admin metadata response rather than the one view.
