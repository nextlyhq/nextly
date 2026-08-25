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
---

Form redirect: mark unpublished pages in the picker, and refuse only the pairing that would send a visitor to a 404.

The picker offers unpublished pages on purpose — a form is usually configured beside the page it points at — but nothing said which of them were drafts. Unpublished pages are now marked, so an author can tell what is live before choosing it.

Saving is refused only when a **published** form points at an unpublished page, which is the one combination a visitor can actually reach. A draft form pointing at a draft page saves normally, since the two go live together. The rule is judged on the state a write leaves behind, so it also catches publishing a form over a draft target in a later save that never touches its settings.
