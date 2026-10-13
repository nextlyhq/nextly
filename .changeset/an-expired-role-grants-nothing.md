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
---

A role given with an expiry date now stops granting anything once that date
passes. Until now the expiry was ignored almost everywhere: an expired role
kept its permissions in every check, an expired super-admin assignment kept
super-admin authority, and login and session refresh still put the role in
the session's claims. Cached permission answers, super-admin answers and API
key grants now also end no later than the expiry of a role they came from, and
a session's access token ends no later than the first of its roles to lapse, so
the client refreshes into claims without it.

Assigning a role whose earlier assignment has expired now gives it again,
instead of answering that it is already assigned. Listing a user's roles shows
only the roles in force. If a user's roles cannot be read at login or refresh,
the session is refused rather than issued with no roles.

Permission answers cached in the database before this release are no longer
read: they could have come from a role that has since expired. They expire and
are cleared as usual, and the first check of each permission after the upgrade
is worked out afresh.

Breaking, for code that builds its own `AuthRouterDeps` for
`routeAuthRequest` (`nextly/auth`, experimental): the `fetchRoleIds(userId)`
dependency is replaced by `fetchSessionRoles(userId)`, which returns
`{ roleIds, validUntil }` (the `SessionRoles` type, now exported):
the role ids in force, and the soonest expiry among them in epoch milliseconds,
or `undefined` when none expires. Read only assignments whose `expires_at` is
empty or later than now. The access token is bounded by `validUntil`.
