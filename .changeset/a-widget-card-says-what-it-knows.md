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

A dashboard widget declared through BOTH channels is now drawn from the registered definition rather than the contributed one. The registry is the single place that knows which widgets exist in a running app, and `overrideWidget` and `extendWidget` exist so a later plugin can correct an earlier widget; preferring the contribution discarded every one of those corrections without saying so. A tightened `requiredPermission` is the case that matters: a widget an operator believed they had restricted was still drawn, and its query still entered the batch, for a user the running configuration said may not see it. The contribution still decides the card's POSITION in the grid, so adding a registration for an id that was already contributed does not move the card.

A widget result is validated against its own `op` before it is read. `{ "ok": true, "result": { "op": "count" } }` previously passed an is-it-an-object check and was then read as a count, and the missing total took the whole grid down with it — replacing every card with an error page, which is the exact blast radius the per-slot shape exists to prevent. A result carrying the wrong op for its widget is still passed through, because the archetype refuses it by name and that sentence is more useful than a generic one.

A custom widget that declares a query is now told when a refetch is in flight. The grid keeps such a card's body through a window-focus refetch, so without this the card reported `aria-busy="false"` while it was reading, and the plugin's own component could not tell a refetch from an idle card — the slot holds the previous answer in both cases. The card's freshness line is shown for these widgets too, since they took part in the batch that produced it.

A card's freshness line keeps advancing while the dashboard sits open. It was computed once at render and the dashboard takes no further renders on its own, so a card fetched hours earlier went on reading "Updated just now". It is now a `<time>` element carrying the exact instant, with the relative label refreshed on a cadence matched to its own age.
