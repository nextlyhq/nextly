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

The Releases calendar now reads the server's calendar, so it tells the truth about a busy month. Every day's count is complete, however many releases the month holds, rather than being worked out in the browser from the first 200 releases; and a release that went out late is on the day it actually went out, not the day it was scheduled for.

The month grid marks today and always offers a Today button. Each release is a chip with its time, its title and its state as an icon and a word (Scheduled, Overdue, Stopped, Published, Cancelled), never by colour alone. A day holding more than fits shows "+N more", counted from the day's full total, and opens that day's complete list, paged, with each release's own row menu.

A time-zone control above the grid starts at the reader's own zone, as the list does, and offers the zones the releases on screen were scheduled in, then any other, searchable. The chosen zone decides which day each release falls on, which month and day are today, and every count, so a release at 22:30 in New York sits on a different day from the same release read in Karachi.

The calendar works by keyboard alone: one tab stop on the focused day, arrow keys by a day or a week, Home and End to the week's ends, Page Up and Page Down by a month (by a year with Shift), Enter to open a day's list or a release, and Escape to close the list. Today is announced as today. On a narrow screen each day shows its count, and opens its list the same way.
