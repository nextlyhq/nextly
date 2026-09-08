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

Published rows only — and NOT by saying so. The read runs as the user, and an untrusted caller that states no lifecycle already gets public states only, asked of the collection's own WORKFLOW. A literal `status: "published"` looked like the same thing and was not: it is ANDed with the service's release-aware condition, so it re-hid a draft belonging to a release whose time had come but whose drain had not run, and `"published"` is a state NAME, so a collection whose workflow calls its public state anything else would have matched nothing and come back empty.

The route is authenticated and declares NO permission, which is deliberate. A declared one has to spell the collection slug, and a host may rename that collection — the seeded grant then carries the new name while the route demands the old one, which is a route nobody can call. The read runs as the user instead, so the service enforces whatever permission the collection actually seeded, under whatever name it actually has.

The wire shape EXTENDS `SavedPattern`, the type the panel actually reads, rather than describing the same thing again. Described separately they disagreed about one field name — the wire carried `content`, which is what the collection stores the tree under, while the panel reads `document` and SKIPS a pattern that has none — so every pattern on every site was dropped in silence and the tier looked wired and empty. Extending the published type makes that a compile error.

A full-page pattern is left out of the insert list, and it is asked as a CLOSED question. `granularity !== "page"` answers true for everything it has never heard of, including a value that is MISSING — the field is required on the collection, so absent means an `afterRead` hook or a field-level read rule removed it, and a page pattern whose granularity was stripped was offered for insertion inside the page it is meant to be. The insertable granularities are now named, so anything unrecognised is refused; refusing wrongly leaves one pattern out of a list, while allowing wrongly puts a whole page inside the page an author is editing.

`PATTERN_GRANULARITIES` moves to the wire contract, which is where both ends can read it: the panel runs in a browser and cannot load the collection module, because that reaches the framework's field helpers. The collection reads its options from the same list, so there is still one vocabulary — and the rule is a `Record` over it, so adding a granularity is a compile error until someone classifies it rather than a value that silently becomes insertable.

The response ceiling now reserves the ANSWER's framing rather than only the rows inside it. `Response.json` wraps the rows in `{"items":[…],"meta":{…}}` and separates them with commas, so a library whose rows totalled exactly the ceiling left the server above it — measured, nine bytes over — and a proxy limit set at the same figure rejects a response this route believed it had bounded.

A full-page pattern is left out of the insert list. It is a way to START a page rather than something to place after the selected block, and `SavedPattern` carries no granularity, so nothing downstream could tell one apart.

It is bounded three ways, and only one of them is a row count. A ceiling counting patterns KEPT is never reached by a page whose every row the reader had to drop, so the READS are bounded too. And BYTES, which no count can bound: one valid document may be two mebibytes and a host may raise that, so three thousand of them is gigabytes assembled on the server and then sent to a browser, from a request an author makes by opening the editor. Whether another page exists is the SERVICE's answer rather than a length this recomputes, because an `afterRead` hook can shorten a page without the collection having ended. The ceilings apply PER ROW, because one checked between pages bounds nothing about the page being read: a single page of a hundred two-mebibyte documents is two hundred mebibytes already assembled, and a library that ends there would have been reported complete. Each row is weighed BEFORE it is kept, so the byte ceiling is an upper bound on the response rather than a line its last row is allowed to cross — measured, appending first and checking after returned 17.8 MB against a 16 MiB ceiling, and a pattern larger than the whole budget came back whole. One that fits in no budget is left out and the read goes on, so the patterns behind it still arrive.

The WHOLE ROW is charged, not its document. Charging the document meant charging the one field that happened to have no bound of its own, and `description` is a `textarea` with no length either — so a library of long descriptions and absent documents scored exactly zero and no ceiling was ever consulted: measured, sixty such rows serialised to 24.0 MB against a 16 MiB ceiling. The weight comes from the engine's `measureBytes`, the same survey the canonical validator asks its size question through, so this agrees with the ceiling a stored document already passed. It counts UTF-8, which is what a byte means on the wire — `String.length` counts UTF-16 code units, so CJK text weighed one third of what it costs and passed roughly three times the nominal ceiling — and it is bounded, so weighing an oversized row does not itself cost its size.

A row that cannot be SERIALISED is dropped rather than counted as free. An `afterRead` hook may hand back a document holding a bigint or a cycle; counting that as costing nothing kept it, and serialising the assembled library then threw — so one malformed row answered the author with a failed request instead of a shorter list. Reaching any ceiling is reported rather than silently truncating a library the author would then search in vain.

The pages are read in a deterministic order. They are independent offset queries and the service adds `ORDER BY` only when a sort is asked for, so an unordered read is free to return rows differently per page — one pattern arriving twice and another never at all.

**`usePluginRoute` is new on `@nextlyhq/plugin-sdk/admin`.** The two halves of a plugin could not reach each other: a plugin may serve an HTTP route and may render admin components, and there was no client for the second to call the first with — so an author's choice was to hand-roll the session, its refresh and the error envelope, or to read something else instead. It goes through the same authenticated client and query cache the admin's own reads use. Three things a consumer must know: the plugin names ITSELF, because nothing in a plugin component's React context says which plugin contributed it; the path is built through the dispatcher's own `pluginRouteFullPath`, so a caller cannot address a namespace the server does not serve — a mistake that does not raise, since a request to a path nothing serves answers with nothing; and `pending` is a real third state, because `undefined` is both "the route answered nothing" and "the route has not answered".

`pluginRouteFullPath` is published from `nextly/config` for that reason, beside `pluginAdminSlug` and for the same one: a slug derived twice produces a dead link, and a route path derived twice produces a request to a path nothing serves. `SavedPattern` is published from `@nextlyhq/builder`, which is the shape a host has to supply for the panel to offer patterns at all — including the two absences that are not interchangeable, `keywords` and `content`, each of which arrives as `null` from a stored row rather than missing.

The library is read when the insert panel OPENS, not when the editor mounts: the shell renders only the open panel, so the read lives in a component mounted with it. An author who works in Layers, or opens no panel at all, never pays for a library they are not looking at — and opening the panel is exactly when someone expects to see a pattern they just saved.

`usePluginRoute` reports a read waiting to RESUME as pending. Offline before the first request, TanStack holds a query at `isPending` with `fetchStatus: "paused"`, so `isFetching` is false while nothing has arrived — and a surface that read it as settled would draw its empty state over a request that has not happened yet.

Its body type is bounded to an object or `null`. The admin's fetcher returns `undefined` for a bare string or number, deliberately, because no endpoint in the admin answers with one — reasoning that holds for the admin and stops holding for arbitrary plugin routes, where `Response.json("ready")` would arrive as a successful empty answer. `usePluginRoute<string>` no longer compiles; a route wanting a scalar wraps it, which the canonical envelopes do anyway.

`usePluginRoute` carries a successful EMPTY answer as success. A 204, a 205 or a zero-length body reaches the hook as `undefined`, and TanStack rejects `undefined` query data outright — so a route that legitimately answered with nothing reported a failure to a plugin that had done nothing wrong. `null` stays distinct from no body at all.

`usePluginRoute` also takes an optional `staleTime`. The admin holds a query fresh for five minutes and does not refetch on focus, which suits lists whose writes invalidate their own keys — and a plugin route is not on that map, since nothing in the admin knows which routes a given write affects. The pattern library asks for `0`, so an author who saves a pattern and then opens a page is not shown a library their own save is missing from.
