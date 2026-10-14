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
---

A plugin route that sets `csrf: true` now checks the origin of a POST, PUT,
PATCH or DELETE that no session authenticates, before its handler runs. Before,
such a request was not checked at all, so a guest-facing route, such as a cart
that keeps its own cookie, accepted a cross-site form post. The request must
name your site or an origin in `NEXTLY_ALLOWED_ORIGINS`, as a signed-in write
must; one naming another origin, or none, is refused with `CSRF_FAILED`. It
is not asked for a CSRF token. A session cookie that is expired or malformed
authenticates nobody, so its caller is checked the same way, and is no longer
asked for a token it could not hold.

Only an `Authorization: Bearer` token, with the scheme in any case, now exempts
a request no session authenticates from the check, whether or not the token is
a valid key. A request a session authenticates is checked as the session's,
whatever header it also carries. Any other
scheme, such as the Basic, Digest, Negotiate or NTLM credentials a browser
attaches on its own, no longer does.

The plugin route documentation now lists which callers each `csrf` setting
checks.

**Compatibility:** a client that writes to a public route with `csrf: true`
without a session or a `Bearer` token, such as a server job, must now send
`Origin` with your site's origin or an allowed one, or it is refused. A route
meant for webhooks or other server callers should leave `csrf` unset, which
still checks no anonymous write. No first-party plugin route sets `csrf: true`.
