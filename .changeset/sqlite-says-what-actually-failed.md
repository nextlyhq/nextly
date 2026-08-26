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

On SQLite, a failed database write is now reported as what actually went wrong,
instead of occasionally being reported as a timeout.

A write that a unique constraint refused — saving a second record with a value
that has to be one of a kind — was being described as the database being busy.
The two mean opposite things. A busy database is a temporary condition worth
trying again in a moment; a refused duplicate will be refused every single time.
Anything that retried on a timeout could therefore retry a permanently
impossible write over and over, and the log would blame the database rather than
naming the duplicate.

The cause was that the description was being read off the query itself rather
than off the error. If the failing statement so much as mentioned a column whose
name contained the word "locked" — and the tables that record sign-in lockouts
and outgoing webhook deliveries both have one — the failure was read as a lock,
whatever had really happened.

This affected the accounts table and the webhook delivery table, so a sign-in
lockout write or a webhook delivery that failed for any reason has been
reporting the wrong cause. PostgreSQL and MySQL were never affected.

Separately, the check for "was this a duplicate?" now looks all the way down a
failure rather than one step in. A database error arrives wrapped twice before
application code sees it, and the detail identifying a duplicate sits at the
bottom, so the check had been answering "no" for genuine duplicates. It also now
stops safely if a failure somehow refers back to itself, rather than looping.
