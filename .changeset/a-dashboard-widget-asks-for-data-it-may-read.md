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

Added the dashboard widget surface: a widget registry, a source registry that names collections rather than tables, a declarative query that is validated before it compiles, and `POST /api/dashboard/query` to run a batch of them for the signed-in caller. Every widget read goes through the ordinary access-controlled path with the requesting user, so a widget returns exactly the rows that caller could have listed itself — including the refusal it would get for filtering or sorting on a field carrying a read rule, which a widget query is given no exemption from. A query that names an unavailable source or an unsupported op, and one that fails while running, both answer with a generic message and put the detail in the log, so the endpoint cannot be used to enumerate an install's collections or to read database error text.

Changed the shape of a plugin's `contributes.admin.widgets` entries. `component` stays REQUIRED, because the dashboard grid renders a widget through its component and through nothing else, so a widget without one would be accepted everywhere and draw an empty cell. The new declarative fields — `title`, `archetype`, `defaultSize`, the size bounds, `query` and `link` — are all OPTIONAL additions, so existing `{ id, component, size }` declarations keep compiling unchanged. `size` is the sizing the current grid reads; `defaultSize` is published for the archetype-driven grid and is not read yet.
