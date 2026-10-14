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

A two-factor challenge is answered once on every instance. The first correct answer now marks its sign-in answered in the database, in a new table `nextly_spent_challenges`, by one write only one caller can win, committed before the session is issued. Any later answer to the same pending token is refused, on whichever instance it reaches, before the challenge's `resolve` runs, and two correct answers at once mint one session. This holds whatever `rateLimit.store` is set to. The one-shot mark used to live in the rate-limit store, so with the default memory store an answered challenge could be answered again on another instance. A challenge pending across the upgrade is answered against the new mark.

The attempt budget is counted in the limit store `rateLimit.store` selects, so with `"database"` wrong answers on every instance spend one budget. An app's own store of the earlier `RateLimitStore` contract keeps serving it. Its keys, which name an account, are stored only as keyed hashes, so a budget pending across the upgrade starts again. When the store can't be reached, or doesn't answer in time, a two-factor answer is refused with "Please try again shortly." (`503`) and no session is minted. The boot warning about a per-instance budget no longer appears when the database store is selected or `rateLimit.singleInstance` is set. Expired marks are removed as new ones are written, an hour after their token's end, so an answer let through before the end always meets them.

`AuthRouterDeps` gains two optional members, `spentChallenges` and `limitStore`, so deps assembled by hand keep working: without `spentChallenges`, the mark stays in the rate-limit store as before. While an app's own store of the earlier contract is configured, the earlier release's mark is also kept there, so during a rolling upgrade instances of either release refuse a challenge the other settled. `nextly/auth` exports `databaseSpentChallenges` and `SpentChallenges` for such a caller to opt into the database's marks.
