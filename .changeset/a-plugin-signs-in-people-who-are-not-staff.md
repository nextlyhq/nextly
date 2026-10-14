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

A plugin can now sign in people who are not staff, such as a shop's customers
or a site's members, without them ever reaching the admin. It registers its
own kind of signed-in person in `contributes.principals`: a name, the
attributes the kind exposes with their types, and a resolver that says who is
signed in from the plugin's own session. Core names the kind
`<plugin>:<name>`, and the app refuses to start on a kind whose name,
attributes or resolver cannot be used, or whose name another plugin's kind
already holds.

Core calls a kind's resolver only where an entry point asks for that kind, and
at most once per request. A plugin route asks with `principal: { kind }`. Its
handler gets the person as `ctx.principal` and never staff: the route reads
neither the staff session nor an API key, and `ctx.auth.currentUser` answers
no user there. A route that requires the kind refuses a request with nobody of
it with the same 401 any route gives an unauthenticated caller. A person's
writes take the route's cross-site check as a staff session cookie's do,
unless the request carries a `Bearer` token. `principal` cannot be combined
with `public` or `requiredPermission`. Server code asks with
`ctx.principals.fromRequest` or `nextly.principals.fromRequest`, which answer
nobody to a write from another site. `nextly plugins info` lists each plugin's
kinds.

The surface is `@experimental` until the feature is complete.
