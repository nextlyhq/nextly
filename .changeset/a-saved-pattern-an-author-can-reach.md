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

An author can insert a saved pattern.

The insert panel has accepted saved patterns since the tier landed, and nothing in the product supplied any — so a pattern could be saved and never seen again. The page builder now serves its library from a route of its own and hands it to the panel.

Published rows only. A draft pattern is one being worked on, and the collection turns drafts on precisely so a pattern can be edited without being offered; putting one in the panel would hand every author on the site a half-built starting point.

The route is authenticated and declares NO permission, which is deliberate. A declared one has to spell the collection slug, and a host may rename that collection — the seeded grant then carries the new name while the route demands the old one, which is a route nobody can call. The read runs as the user instead, so the service enforces whatever permission the collection actually seeded, under whatever name it actually has.

It is bounded twice, and the second bound is the one that is easy to miss: a ceiling counting patterns KEPT is never reached by a page whose every row the reader had to drop, so the reads are bounded as well as the results. Reaching either is reported rather than silently truncating a library the author would then search in vain.

**`usePluginRoute` is new on `@nextlyhq/plugin-sdk/admin`.** The two halves of a plugin could not reach each other: a plugin may serve an HTTP route and may render admin components, and there was no client for the second to call the first with — so an author's choice was to hand-roll the session, its refresh and the error envelope, or to read something else instead. It goes through the same authenticated client and query cache the admin's own reads use. Three things a consumer must know: the plugin names ITSELF, because nothing in a plugin component's React context says which plugin contributed it; the path is built through the dispatcher's own `pluginRouteFullPath`, so a caller cannot address a namespace the server does not serve — a mistake that does not raise, since a request to a path nothing serves answers with nothing; and `pending` is a real third state, because `undefined` is both "the route answered nothing" and "the route has not answered".

`pluginRouteFullPath` is published from `nextly/config` for that reason, beside `pluginAdminSlug` and for the same one: a slug derived twice produces a dead link, and a route path derived twice produces a request to a path nothing serves. `SavedPattern` is published from `@nextlyhq/builder`, which is the shape a host has to supply for the panel to offer patterns at all — including the two absences that are not interchangeable, `keywords` and `content`, each of which arrives as `null` from a stored row rather than missing.
