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

Reviewers find waiting work in the admin. The Content panel leads with "Waiting for my review" wherever the reader may take a step, a page listing each part waiting for them with its title, its collection or Single, its stage and whom it waits for (`GET /admin/api/workflows/waiting/scope` says whether anything can wait for the reader), and Needs attention counts "Waiting for your review". A collection list takes two more top-level filters: `_assignedToMe: true` keeps the documents with a part assigned to the reader or one of their roles, and `_changedSinceApproved: true` keeps those with a part saved again since its last approval (the version the "Since approved" comparison reads). A collection list's bulk bar offers Submit for review, Assign and Send back on a collection a workflow holds, naming each refusal; approval is never offered in bulk.
