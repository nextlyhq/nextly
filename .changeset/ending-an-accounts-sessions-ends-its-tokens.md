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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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
---

Deactivating an account, or an administrator setting its password, now ends
the access tokens it already holds within ten seconds, wherever a session is
read: `getSession` and `requireAuth`, `GET /auth/session`, `/api/auth/state`,
a plugin's `ctx.auth.currentUser`, and the admin API. That includes the
thirty-day token from the Direct API's `nextly.login()`. Before, a token
stayed valid until it expired. A person changing or resetting their own
password ends their other sessions the same way.

Each access token carries the account's session epoch, in a new reserved
`nx_sev` claim, from a new nullable `users.session_epoch` column that the
write ending the account's sessions raises. A custom user field or
`customizeClaims` claim of that exact name is not kept; any other name,
plain `sev` included, is untouched. Each read checks the token against the row, which is cached for five
seconds per account per process. A token for an account that no longer
exists, or is not active, is refused too. Run `nextly migrate` to add the
column to an existing database; no row is rewritten. Tokens issued before
the upgrade keep working until the account's next change.

Because a session read now checks the database, `getSession` and
`requireAuth` from `nextly/auth` need Nextly initialised in the process. In
your own route, call `await getNextly({ config })` before reading the
session, or initialise Nextly in `instrumentation.ts` with
`createRegister(config)`. Nextly's own routes start it themselves. A session
read in a process where Nextly has not been initialised fails with an
internal error, and the server log names this fix. The blog template's seed
routes do this now.

`getSession`, `requireAuth` and `ctx.auth.currentUser` can now throw: when
the account's row cannot be read, or the read takes longer than five
seconds, the request fails rather than being answered either way. Before,
they never read the database. `verifyAccessToken` still checks only a
token's signature; read sessions through `getSession` or `requireAuth` to
get the cut-off. `GET /api/auth/state` refuses a token whose account's
sessions were ended, and still reports an inactive account whose sessions
were not as `disabled`.

`buildClaims` takes an optional `sessionEpoch`. Left out, it is zero, so a
token built that way works until the account's sessions are first ended.
`AccountState` now carries the account's `email`, `name`, `image` and
`sessionEpoch`. If you assemble `AuthRouterDeps` yourself, your
`fetchAccountState` and the session-row `lockAccountState` must return those
fields from the user row, and `setInitialPassword` must return the
`sessionEpoch` its write left beside `passwordUpdatedAt`, and
`findUserByEmail` must return the row's `sessionEpoch` with its
`passwordHash`. Until they do, no session is issued from them, and the log
names what is missing. A sign-in is judged against the epoch its proof was
made at, and a later read cannot stand in for it. A second-factor sign-in
paused before the upgrade is refused when answered, and the person signs in
again.

A session's `email`, `name` and `image` claims now come from the account the
sign-in checked, not from the user an `afterAuthenticate` hook returned.
