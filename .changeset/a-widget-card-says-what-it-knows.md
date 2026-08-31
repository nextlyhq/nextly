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

A dashboard widget declared through BOTH channels is now MERGED, with the registered definition authoritative over every field it can state. The registry is the single place that knows which widgets exist in a running app, and `overrideWidget` and `extendWidget` exist so a later plugin can correct an earlier widget; preferring the contribution discarded every one of those corrections without saying so. A tightened `requiredPermission` is the case that matters: a widget an operator believed they had restricted was still drawn, and its query still entered the batch, for a user the running configuration said may not see it.

Merged rather than substituted, because a registered definition cannot carry a `component` on any archetype but `custom` — so replacing the contribution with it would discard the only thing on either side able to draw a `list`, `table`, `text` or `actions` card, and a widget that had been rendering its plugin body would render "the list widget archetype is not rendered yet" instead. The contribution supplies the component and the trimmings the registration left out; the registry supplies the permission, the query, the archetype, the title and its declared size. The card keeps the POSITION the contribution gave it, so it does not jump across the grid, but it takes the registry's `defaultSize`, so its width can change to what the authoritative definition asks for.

Relatedly, a widget that names an archetype this release does not draw now falls back to a component it shipped, rather than showing an error where a working card was available. The fallback is asked of the archetype table itself, so it stops applying on its own the day core learns to draw that archetype. And a duplicate id inside the registry payload is now resolved to its first entry on both read paths, so deduplication and the permission gate cannot disagree about which of the two the payload meant.

A widget result is validated against its own `op` before it is read. `{ "ok": true, "result": { "op": "count" } }` previously passed an is-it-an-object check and was then read as a count, and the missing total took the whole grid down with it — replacing every card with an error page, which is the exact blast radius the per-slot shape exists to prevent. A result carrying the wrong op for its widget is still passed through, because the archetype refuses it by name and that sentence is more useful than a generic one.

A custom widget that declares a query is now told when a refetch is in flight. The grid keeps such a card's body through a window-focus refetch, so without this the card reported `aria-busy="false"` while it was reading, and the plugin's own component could not tell a refetch from an idle card — the slot holds the previous answer in both cases. The card's freshness line is shown for these widgets too, since they took part in the batch that produced it — but withheld when their slot was a refusal, because the batch's timestamp is true of the request and not of a card whose body is drawn from a failure.

A card's freshness line keeps advancing while the dashboard sits open. It was computed once at render and the dashboard takes no further renders on its own, so a card fetched hours earlier went on reading "Updated just now". It is now a `<time>` element carrying the exact instant, with the relative label refreshed on a cadence matched to its own age.
