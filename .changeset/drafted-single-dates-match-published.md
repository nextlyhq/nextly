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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

A date field on a single (a settings page, a homepage — any one-off document)
now comes back the same way whether you are looking at the published version or
at unpublished changes.

Before, the published version handed your code a real date and the unpublished
one handed it a piece of text that merely looked like a date. Anything that then
asked the date a question — what year is this, is it before that — worked on the
published document and failed on the one with pending edits. The failure only
appeared once someone had unsaved changes, which is exactly when it is hardest
to connect to a cause.

The shaping that produces an unpublished document now restores date values the
same way an ordinary read does, so both come back in the same form.

System timestamps such as "last updated" are deliberately left as they were.
Singles and collections genuinely present those differently, and making them
uniform here would have fixed one and broken the other — so which behaviour
applies is now stated explicitly by each caller rather than assumed.
