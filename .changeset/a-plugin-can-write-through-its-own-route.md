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

**`usePluginRouteMutation` is new on `@nextlyhq/plugin-sdk/admin`.** A plugin could READ its own contributed route and had nothing to write to it with, so any feature that saved something was back to hand-rolling the session, its refresh and the error envelope — the exact problem `usePluginRoute` was added to remove, left standing on the other half of the same seam.

It goes through the same authenticated client and the same query cache the admin's own writes use. Four things a consumer should know:

The plugin names ITSELF, as it does for the read, because nothing in a plugin component's React context says which plugin contributed it.

`invalidates` names the plugin's own read paths, so a write refreshes the list it belongs in. Named rather than inferred: nothing in the admin knows which reads a write affects, and that is the plugin's own knowledge. Each path is resolved through the calling plugin's name, so one plugin cannot invalidate another's cached reads however it spells a path.

`write` RESOLVES on failure rather than rejecting, answering `undefined`, and reports the cause on `error`. A rejecting promise is the idiomatic TanStack shape and a footgun on a surface handed to plugin authors: a caller who does not wrap the await gets an unhandled rejection for a failure that is already reported. It is the shape the read hook has, so there is one thing to learn rather than two.

Nothing is toasted from the hook. The admin's own mutation hooks raise a toast because they own the surface that follows; a plugin owns its own, and a generic hook that announced every write would put the admin's voice inside someone else's feature.

**A plugin write is never retried automatically**, which overrides the admin's own default of two. The admin retries its own mutations because they address routes it owns and knows the shape of; this addresses a route a plugin wrote, with no idempotency key and no requirement that the route be idempotent, and the default verb is `POST`. A create that commits and then loses its response would be sent again — twice — and an author gets three rows for one click with nothing reporting it. The asymmetry decides it: a write that is not retried costs a failure the caller is told about and may repeat deliberately; a write retried wrongly costs duplicate data nothing can identify afterwards.

**The target travels with the body.** A write paused offline has its options updated before its retryer runs, so a closed-over route would send a body submitted against one endpoint to whichever the hook was rendered with by the time the connection returned.

**Every write is reported, not only the newest.** TanStack's observer follows the most recent call, so with two writes in flight — a double submit, an autosave overlapping a save — the older one's rejection reached no observer: `error` never saw it and `pending` went false while that request was still running.

`TBody` is bounded to `JsonValue`, published from `nextly/config` beside `RouteMethod`. Every sender applies `JSON.stringify`, so a `Date`, a `Map`, `FormData`, a function or a bigint is silently changed, dropped, or throws — the compiler refuses them now, where the author can still see what they meant.

The write verbs are `Exclude<RouteMethod, "GET">` rather than a second list of methods. Spelled out, that was a narrower view of the route contract that would stop covering it the moment a method was added: a plugin could declare the route and this could not call it, and nothing would fail. `RouteMethod` is published from `nextly/config` for that, beside `pluginRouteFullPath` and for the same reason — the admin has to agree with the dispatcher about what a route is.

`protectedApi.delete` now sends a body the caller SUPPLIED rather than one that is truthy. `false`, `0`, `""` and `null` are valid JSON, and a truthiness test dropped all four, so `delete` was the one verb that silently disagreed with what it was passed. Measured before changing it: no caller passes a body at all today, so nothing that exists sends one where it did not before.

The result type is bounded to an object or `null`, for the reason the read is: the admin's fetcher returns `undefined` for a bare string or number, so `Response.json("ok")` would arrive as a successful empty answer and a caller typed `<string>` would silently never see it.
