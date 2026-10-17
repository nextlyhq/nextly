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

Sign-in can no longer be locked for everyone by one visitor. Without
`security.trustProxy`, the default, no client address can be read from a
request, and every auth request counted in one shared bucket: thirty requests
an hour from anyone answered every user's next sign-in, staff included, with 429.

A request whose address cannot be resolved now counts against the account it
names, spelled as the account lookup spells it, at the configured budget (30 an
hour by default), whether or not that account exists. A reset, an email
verification, an invite or a pending sign-in counts against the account its
token belongs to; a token that belongs to nobody, or a body that names no
address, counts in one account-less budget that no account's requests touch.
All of them together are held to a ceiling of a hundred times the budget (3,000
an hour by default), so inventing addresses buys no extra capacity. Someone who
knows an address can still spend that one account's budget, and a stream at the
ceiling's rate can still hold unresolvable sign-in shut while it runs.

Requests whose address resolves through a trusted proxy keep their per-address
bucket, unchanged, and a budget of 0 still turns the limiter off. The 429
responses keep their shape and `Retry-After`.

The password-reset and email-verification token tables gain an index on the
token hash, which is how those tokens are looked up; until now each lookup
read the whole table. Run `nextly migrate` to add the indexes to an existing
database. No row is changed. A plain boot does not add them.
