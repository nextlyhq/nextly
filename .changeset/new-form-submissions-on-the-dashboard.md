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

The form-builder plugin adds a dashboard card, New form submissions, declared
with `defineWidget`. It lists the submissions nobody has opened yet, newest
first: who sent each one (their name or email, where the form asks for one),
the form and the first line of the first text answer, and when. A row opens
the submission, and the card's footer leads to every submission. While nothing
is new it stays on the dashboard and says "No new submissions", with a link to
all of them.

The card reads as the person viewing it, so a submission of a form they may
not read is never listed or counted. It is shown to someone who may read the
forms and the submissions while at least one form is theirs to read, and it
puts the same count in the dashboard header's summary. Its id,
`NEW_SUBMISSIONS_WIDGET_ID` (`form-builder/new-submissions`), is exported for a
site's own default layout to name.
