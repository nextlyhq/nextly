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

Review moves from the entry list report and refresh what they changed. A bulk move sent in several requests keeps and reports what the earlier requests moved when a later one fails, says how many were never sent and why, and clears the selection once answered. A sole submit step that needs a comment asks for it before a bulk Submit for review. The list offers its bulk moves to a reviewer who may take its submit or send-back step on that collection, rather than to anyone who reviews anywhere. A link choosing a review filter is read without waiting for the plugins' metadata. The "Waiting for my review" view reads each page past the first from the cursor the page before handed back, so pages past the server's scan ceiling are reached. Taking a step, assigning a part, or saving a workflow's settings refreshes the waiting view, the lists, and (for a saved stage label) the metadata of the collections and Singles the workflow holds. The collection and Single schema reads name each workflow step's `commentRequired` and the `action` it needs.
