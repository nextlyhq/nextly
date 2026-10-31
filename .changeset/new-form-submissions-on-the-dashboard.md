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
new. Once it is marked, the dashboard's cards and its header count are asked
again, so a dashboard left open behind the new tab stops listing it. The
card's title carries how many are new ("New form submissions 3"), the total
its header part counts, and no count while none are. A reader of more than
1,000 forms has the first 1,000 counted, and both the title and the header
say it is a floor ("1000+"). The card's
footer leads to every submission. While nothing is new it
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

A submission created through a request (a visitor's, or any HTTP create) is
now stored with the server's `submittedAt`, whatever date it sends, so a
visitor cannot date a submission into the future to keep it at the top of
the card. A create made on the server with no request behind it, such as an
import restoring old submissions, keeps the date it names.

A widget's `summary.count` may now answer `{ count, atLeast }` as well as a
number (`WidgetSummaryCount`), and the dashboard header shows a floor as
"N+"; a widget answering a plain number is unchanged.

`@nextlyhq/plugin-sdk` adds two types to its root, `AnyWidget` and
`WidgetReadServices`, for a plugin's widget code to be written in, and four
parts to its widget kit at `@nextlyhq/plugin-sdk/admin` (experimental, like
the rest of the kit): `formatWidgetTime`, a row's time as core's list cards
word it; `useWidgetClock`, the minute clock they move it on with;
`Widget.useTitleCount`, the frame's hook that shows a count beside a card's
title and reads it with the title, as the Needs your attention card shows its
items, a floor as "N+"; and `useRefreshDashboard`, which asks the dashboard's
cards and header summary again after a widget's own write.
