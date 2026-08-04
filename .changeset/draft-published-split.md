---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
---

You can now edit a published document without changing what visitors see.

Saving changes to a published document (without choosing Publish) now keeps them as a pending draft: the live version stays exactly as it was until you publish. Clicking Publish brings the whole pending draft live at once, including fields the Publish action itself did not resend, and Unpublish does the same in reverse while returning the document to draft. Trusted editors see their pending edits when they open the document; anonymous and published-only reads always get the live version. This applies to non-localized collections that have draft/published status with drafts-enabled versioning; localized collections are unchanged for now.
