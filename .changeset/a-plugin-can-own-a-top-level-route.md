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

A plugin can now serve a route at a top-level path instead of under
`/plugins/<plugin-name>`, by declaring `mount: "root"`. That is what lets a
plugin take over an endpoint the core stops shipping without every caller
having to change the URL they already use.

It cannot take a path the core serves. Root routes are matched only after the
built-in router has declined, so the core's answer always comes first: a plugin
declaring `/collections` gets the collections API like anyone else, not control
of it. The ordering is the guard rather than a list of reserved prefixes, which
would have to be updated every time the core gained a route and would fail
silently when it was not.

Two plugins still cannot claim one address: rooting a route keeps the collision
check that the namespace used to make unnecessary. That check asks within a
mount, because the two are matched in separate passes and a root route that
merely resembles a namespaced one never competes with it for a request.

A route is also refused at boot when it is rooted somewhere the request never
arrives, rather than registering and silently answering nothing.

A request that could reach a plugin route always waits for initialisation to
finish, not merely for the routes to appear. The route registry fills partway
through startup, so a second request arriving in that window could previously
run a handler before permissions were seeded and migrations had settled.

Nothing changes for a route that does not ask. The default is unchanged, so
every existing plugin route stays where it is.
