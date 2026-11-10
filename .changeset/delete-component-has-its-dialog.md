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

Delete component has its dialog in the admin. The component store's own Delete, in the document's menu, is now "Delete component…", and so is each row's action on the store's list. The dialog lists the documents that use the component, offers to turn each copy into plain blocks and then delete it, and shows the delete's progress until it finishes. It also says what stops a delete: a Layout that uses the component, a document it can't change, a delete someone else is running, or missing permission. It follows the configured component store, the plugin's own collection or a host's. A collection can now set `admin.disableDelete` to hide the admin's own Delete for its entries on list rows, in the selection bar and in the editor, where a plugin may replace that Delete with an action of its own. Removing a shared style now says that a class written by hand, outside the editor, isn't counted.
