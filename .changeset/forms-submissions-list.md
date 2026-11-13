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

The form submissions list shows each form's labels as its columns and a choice
by its option's label (for example "Backend engineer" rather than
`backend-engineer`), on a form's Submissions tab and in the list of every
form, which shows who sent each submission, its form and a summary. The list
filters by date (today, the last 7 or 30 days, or a range of days) as well as
by status, with each status tab's count beside it. Ticked rows can be marked
as read, archived, moved to or out of Spam, exported or deleted, for those
rows alone, each offered only to a role allowed to do it; Delete asks first.
Export, with no rows ticked, exports everything the current filter shows, as
a CSV headed by the form's labels or as JSON. The export route accepts the
list's date filter (`from`, `to`) and the ticked submissions (`ids`), and its
CSV reads a choice by its option's label.
