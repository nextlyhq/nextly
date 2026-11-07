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

A published page now holds its address in the page builder's address store, and a page whose Collection list is split into pages holds that list's later pages too, written in the same transaction as the save. A save that would give two documents one address is refused with a conflict naming the other document (by id where the person saving may not read it): a page published among a paginated page's later pages, or a list split into pages over a published page. Unpublishing or deleting a page frees its address, turning pagination off frees the later pages, and a site upgrading claims its published pages in the background after start-up. In-transaction hook handlers receive an experimental `transaction` token for the collection service's in-transaction methods, closed once the call settles, and an experimental `transactionKey` that every call on one transaction shares. A page's address follows the host's `pagePreviewPath` where it is set. `@nextlyhq/plugin-sdk` now exports `previewUrlFromTemplate` and `readableTitleText`, both experimental, so a plugin fills a path template and reads a title as the core does.
