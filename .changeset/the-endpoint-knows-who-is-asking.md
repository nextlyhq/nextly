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
---

The Model Context Protocol endpoint knows which caller it is serving.

A plugin route handler is called with the request AND the route context, and the
endpoint declared only the first. The services facade and the authenticated user
were therefore discarded before the protocol layer saw them, which cost nothing
while the endpoint exposed no tools and would have cost a great deal the moment
one arrived: a tool would have read and written with no user attached.

The context now travels as itself, scoped to the request. A key's own grants are
untouched by this, because they already are ambient: the plugin dispatcher runs
every handler inside the caller scope, so a service call made anywhere in the
request is judged on the grants stamped on the key rather than on the roles of
whoever minted it. Repeating that here would have answered one question twice.

A request whose caller cannot be established is now refused at construction
rather than served a server built for nobody.

The endpoint also gains its auth proof matrix, driven through the real
dispatcher with a real API key: an unauthenticated caller is refused, an
unverifiable credential is refused, a real key is served, and the address guard
is shown refusing that same key on a foreign Host and a foreign Origin while
serving it on the configured site's own. That last pair is the first time the
guard has been observable at all, because an unauthenticated probe never reaches
it.
