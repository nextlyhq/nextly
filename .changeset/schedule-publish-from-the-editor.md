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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The editor's Publish button gains an arrow with "Schedule publish…" and "Add to release…". Schedule publish… asks for a date, a time and a time zone, says back when the document will go live, and refuses a time that has passed. It then makes a release holding only this document, scheduled for that time, in one step that lands whole or not at all. The release shows at once in the scheduled-release banner and in the document panel's Publishing section, which also offers Schedule publish… while the document is not scheduled. For a person who may not create and schedule releases, or publish the document, or who is on a translation, it stays in the menu, held, with the reason. While someone else is editing the document, it and Add to release… are held as Publish is. Where saving publishes at once (a live document with no drafts), the dialog says so rather than promising later saves wait for the release. Add to release… moves from the More menu to the same arrow. Where saving leads instead of publishing, on a published document with no unsaved edits, both stay in the More menu. The release is named after the title as it stands in the editor, saved or not. A release dialog left open by moving to another document no longer reopens on coming back.
