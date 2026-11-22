---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

Plugins get an experimental `useDocumentSession` in `@nextlyhq/plugin-sdk/admin`, for a document view that edits another document in place while its own stays open, such as a site header edited from the page it sits on. It reads that document's latest version (its working draft where one is held), holds its soft lock and names whoever holds it instead, saves it as a draft or publishes it through the admin's own update as the signed-in person (sending the version the copy started from, so a newer save is refused), says whether the person may publish it, and records a recovery point for it, which that document's own editor offers after a crash. Passing no document, or unmounting, lets the lock go. This is a deliberate widening of the admin surface, held experimental until editing in place settles.
