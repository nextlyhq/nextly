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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Label both ends of a date range, instead of relying on a placeholder that never renders.

A date input paints its own `dd/mm/yyyy` format hint and ignores `placeholder` outright, so a range written that way drew two identical empty boxes with nothing saying which end was which. The same spelling renders correctly on text and number inputs, which is why it survived: the defect is specific to one input type and invisible in the source.

Both date ranges in the admin -- the condition row and the entries filter menu -- now use one `RangeField` with real `<label>` elements bound to their inputs, and the pair is exposed as a named group. The filter menu had no accessible name on either input at all.
