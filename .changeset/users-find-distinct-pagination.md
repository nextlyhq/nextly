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

fix(nextly): paginate users by user rather than by role-joined row

listUsers applied LIMIT/OFFSET to a query that left-joined user_roles and roles
and grouped afterwards, so a user holding three roles consumed three rows of the
page. A page of N therefore returned fewer than N users, and OFFSET advanced
over joined rows rather than users — which skipped users entirely rather than
merely short-filling the page. Measured on nine users with two holding three
roles each: walking every page visited six of them.

The page query now selects one row per user and roles are fetched for exactly
the users that page selected, so total keeps counting the same thing it always
did and a page of N contains N distinct users. Role order per user is now
deterministic; the join left it to the planner.
