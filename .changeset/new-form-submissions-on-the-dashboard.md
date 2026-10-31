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
first: who sent each one (their name or email, where the form asks for one,
with common spellings of a name field such as `firstName`, `first_name` or
"Your full name" recognised), the form and the first line of the first text
answer, each held to 140 characters, and when, in words that move on while
the dashboard stays open and as a date in the admin's timezone from a week
on. Opening a row marks that submission read, as the person opening it and
only while it is still new; someone who may not update submissions leaves it
new. The card's footer leads to every submission. While nothing is new it
stays on the dashboard and says "No new submissions", with a link to all of
them, to the collection as the site installed it, renamed or not.

The card reads as the person viewing it, so a submission of a form they may
not read is never listed or counted. It is shown to someone who may read the
forms and the submissions while at least one form is theirs to read, and its
own read, asked for no rows, puts the same count in the dashboard header's
summary. Its id, `NEW_SUBMISSIONS_WIDGET_ID` (`form-builder/new-submissions`),
is exported for a site's own default layout to name.

The submissions collection now indexes its `status` and `submittedAt` fields
(`idx_dc_form_submissions_status`, `idx_dc_form_submissions_submitted_at`), which
the card's read filters and sorts by. A development server adds them on its
next start; a production site adds them with its next `nextly migrate:create`
and `nextly migrate`. Nothing is dropped or rewritten.

`@nextlyhq/plugin-sdk` adds two types to its root, `AnyWidget` and
`WidgetReadServices`, for a plugin's widget code to be written in, and two
parts to its widget kit at `@nextlyhq/plugin-sdk/admin` (experimental, like
the rest of the kit): `formatWidgetTime`, a row's time as core's list cards
word it, and `useWidgetClock`, the minute clock they move it on with.
