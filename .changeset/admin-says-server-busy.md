---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

When the server refuses the admin's first sign-in check because too many requests have reached it (a 429), the admin now says so: "The server is busy." with "Trying again in N s.", and it checks again by itself when that wait is over. The wait is the one the server named, in its `Retry-After` header or its error's `retryAfterSeconds`, or 10 seconds when it named none. "Try again now" checks at once.

The admin used to say it couldn't reach the server, which suggested the server was down. A busy server is up, and asking again before the wait it named only uses more of the limit that refused the request, so the check no longer retries a 429 on its own quicker schedule.

A server that can't be reached, or that answers with a 5xx, keeps today's "The admin can't reach the server." screen and its Try again button.
