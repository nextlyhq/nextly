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

Reviewers find waiting work in the admin. The Content panel leads with "Waiting for my review" wherever the reader may take a step: a page listing each part waiting for them with its title, its collection or Single, its stage and whom it waits for (`GET /admin/api/workflows/waiting/scope` says whether anything can wait for the reader), and Needs attention counts "Waiting for your review". A collection list a workflow holds shows a Review column (each part's stage, whom it waits for, when it is due) and filters by stage and by review; its rows are selectable for a reviewer, and its bulk bar offers Submit for review, Assign… and Send back…, naming each refusal (approval is never offered in bulk). The list read takes `reviewState: true` (`?reviewState=true`) to give each row its review state under `_review`, never a visitor's rows, and four more top-level filters: `_stage: "<stage>"`, `_assignedToMe: true`, `_waitingForMe: true` (by the waiting list's own read; an API key by its own scope, and the total marked a floor when the read stopped short) and `_changedSinceApproved: true`. A part in a language the reader may not read is never listed, counted or shown. A collection's or Single's schema read names its workflow's stages, each by the label saved in Settings, and its steps. A direct list now says when its total is a floor (`meta.totalCapped`), as REST does.
