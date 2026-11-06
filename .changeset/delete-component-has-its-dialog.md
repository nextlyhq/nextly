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

Delete component has its dialog in the admin. "Delete component…" sits in a component's document bar and on each row of the Components list. The dialog lists the documents that use the component, offers to turn each copy into plain blocks and then delete it, and shows the delete's progress until it finishes. It also says what stops a delete: a Layout that uses the component, a document it can't change, a delete someone else is running, or missing permission. A collection can now set `admin.disableDelete` to hide the admin's own Delete for its entries, in the editor, on list rows and in the selection bar. Components set it, so the only delete offered for a component is Delete component. Removing a shared style now says that a class written by hand, outside the editor, isn't counted.
