---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
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

Added the dashboard widget surface: a widget registry, a source registry that names collections rather than tables, a declarative query that is validated before it compiles, and `POST /api/dashboard/query` to run a batch of them for the signed-in caller. Every widget read goes through the ordinary access-controlled path with the requesting user, so a widget returns exactly the rows that caller could have listed itself — including the refusal it would get for filtering or sorting on a field carrying a read rule, which a widget query is given no exemption from.

The sources a widget may name are derived from the collection registry, which is what makes BOTH ways of defining a collection queryable: a collection drawn in the Schema Builder lives only in that registry and has no entry in `nextly.config.ts` at all. They are read where a query needs them rather than snapshotted at boot, so a collection created while the app is running is queryable without a restart, and one that has been deleted stops being nameable.

The endpoint decides whether the caller may read a source BEFORE it says anything specific about the query. A source the caller may not use answers exactly as one that does not exist does — same for an unsupported op and for a query that fails while running — with the detail in the log, so the endpoint cannot be used to enumerate an install's collections or to read database error text. A malformed request body answers in the same `{ error: { code, message, requestId } }` envelope as every other endpoint.

Changed the shape of a plugin's `contributes.admin.widgets` entries. `component` stays REQUIRED, because the dashboard grid renders a widget through its component and through nothing else, so a widget without one would be accepted everywhere and draw an empty cell. The new declarative fields — `title`, `archetype`, `defaultSize`, the size bounds, `query` and `link` — are all OPTIONAL additions, so existing `{ id, component, size }` declarations keep compiling unchanged. `size` is the sizing the current grid reads; `defaultSize` is published for the archetype-driven grid and is not read yet.

A widget definition is validated more completely at registration: `defaultSize` must sit inside `minSize`/`maxSize` rather than only those two agreeing with each other, `defaultHeight` must name a real height rather than being enforced by the type alone, a `custom` widget's `component` must be more than an empty or whitespace-only string, and `overrideWidget(id, def)` requires `def.id` to be the id it replaces. The registry stores an immutable snapshot, so a definition edited after registration no longer bypasses validation, the `extendWidget` patch allowlist or the `overrideWidget` path. `WidgetHeight`, `WIDGET_HEIGHTS` and the source-contract vocabularies (`WidgetSourceField`, `WidgetSourceFieldType`, `WidgetSourceKind`, `WidgetOp`) are exported from the root, so every type a published shape names can be named. A collection declared `timestamps: false` no longer offers `createdAt`/`updatedAt` as selectable or sortable fields it does not have.

A source's `kind` is now derived from its id: the `collection:`, `single:` and `system:` namespaces are reserved for their own kinds, so a source cannot be registered whose id and kind disagree — which previously let a plugin claim `collection:posts` and make every dashboard query request fail when the collection sources were next rebuilt. Source registration also stores an immutable snapshot, so the field allowlist a query is checked against cannot be edited after it was validated. The fields a collection exposes are read through the shared addressable-fields walk, so a field inside an unnamed presentational group — stored at the collection's top level — is selectable, sortable and filterable, while a field inside a repeater, stored per row, is correctly not offered.

A `near` or `within` filter is validated with the same parsers that execute it, so a malformed geo value is refused instead of being accepted and then silently dropped — which had left the query running with no condition at all and returning the whole collection. A widget contributed by a plugin is checked at boot for values that cannot survive being serialized to the browser, because a contributed widget is copied into the `/api/admin-meta/workspace` payload and one that cannot be encoded failed that request for every admin rather than only its own card. `POST /api/dashboard/query` answers a body that is not valid JSON with the canonical validation envelope rather than a 500, and the dashboard routes no longer match a URL carrying extra path segments.
