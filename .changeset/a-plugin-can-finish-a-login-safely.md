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

A plugin that has authenticated someone elsewhere — an OAuth callback, say —
can now finish the login through the core session path with
`ctx.auth.completeLogin`. It applies the same account-state rules, the same
hooks and the same audit trail as a password login, so a plugin cannot grant a
session core would have refused, and every plugin fails the same safe way.

Preconditions run before any hook that could act, so an account that may not
hold a session never triggers a second-factor code being sent to it. The
password-attempt lockout does not apply, because an external login is not a
password attempt and otherwise anyone knowing an address could lock its owner
out of their provider.

A login interrupted by a second factor now resumes without a token ever
appearing in a URL. The pending token travels in an HttpOnly cookie and the
login page asks `GET /auth/pending` which challenge is outstanding; the token
itself is never returned to the page.

`ctx.auth.currentUser(request)` reports the signed-in user for a plugin route
that behaves differently when someone is already signed in.

Breaking, for plugins that contribute a challenge view: the host now posts the
answer, and the component receives `resolve(response)` instead of posting the
`pendingToken` itself. A resumed login has no token in the browser to hand it.
`pendingToken` stays in the props for one minor, deprecated, and is undefined
in resume mode. `onResolved` receives the path to land on.
