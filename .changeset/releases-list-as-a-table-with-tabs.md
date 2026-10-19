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

The Releases list is now a table with four tabs, Upcoming, Needs attention, Drafts and Done, each showing how many releases it holds; every release is in exactly one of them. The list pages like the other admin tables ("Showing 1–20 of N", page buttons and rows per page), and its search looks at titles and descriptions across every page, not only the rows on screen. The tab is kept in the address, so `?tab=attention&reason=overdue` opens Needs attention narrowed to overdue releases.

Each row shows when the release runs, with how far away that is ("in 3 days"); how many documents it holds and what it does with them ("5 go live, 1 comes down"); how many are ready, with a bar and a count of those that need a fix; its state, with an icon and a word, so a stopped or overdue release is never told apart by colour alone; its owner; and a menu of the actions the reader may take (schedule or reschedule, publish now, cancel, delete). A release holding a single document is marked as one, and a switch hides them. Each tab says what it holds when it is empty, and with no release at all the list explains what a release is.

Times are shown in the reader's own time zone. Where a release was scheduled in a zone whose clock reads differently, the time there is shown too, labelled as scheduled: "Fri, Oct 16, 2026 10:00 PM your time · Sat, Oct 17, 2026 7:00 AM Asia/Karachi (as scheduled)".

The releases API gains two reads for a page of releases at once, both experimental. Each release on the REST list now carries `memberCounts` (`total`, `goLive`, `comeDown`), read for the whole page in one query; from the Direct API, `nextly.releases.memberCounts({ releaseIds })`. `GET /api/releases/readiness?ids=…` and `nextly.releases.readinessOf({ releaseIds })` answer up to 50 releases' readiness in one request, each exactly as the single read answers it and under the same permission; a release holding more documents than the limit comes back unchecked, and more than 50 ids are refused with a 400. The admin list uses them, so a page costs two requests rather than two per row.
