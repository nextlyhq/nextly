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
"create-nextly-app": patch
"nextly": patch
---

Add a calendar view of what ships when. The releases page now offers two views of the same set: a list, which answers what launches exist, and a month grid, which answers what is coming and whether anything collides — a question the list can only answer by being read end to end. Each day shows how much is happening and whether any of it has stopped, and selecting a day lists those releases at full width; a month grid goes unreadable if the releases themselves are drawn into it, and the cells are narrow at any window size. Narrow screens get the month as an agenda instead of a squeezed grid, because somebody on a phone is usually asking what happens next rather than what collides.

The times are shown in a zone the reader chooses, named on the page, and remembered between visits. This is not a detail: a release carries an instant and the author's timezone, so which day it lands on has no answer until a zone is named — a launch at eleven at night in New York is the following day in London. Without an explicit choice two colleagues comparing the same page would see one launch on two different days, with nothing on screen to explain why. The zone arithmetic the schedule input already used has moved into one module shared by both, since two implementations of a timezone conversion agree until a daylight boundary and then differ by an hour in a way neither screen can show.
