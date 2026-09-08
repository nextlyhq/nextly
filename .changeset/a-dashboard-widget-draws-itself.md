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

The dashboard now draws widgets. The server half — the registry, the query
contract and `POST /api/dashboard/query` — has been merged and unused, with
nothing on the client asking it anything.

Widgets share one anatomy: a header, a body, and an optional footer carrying a
freshness line and at most one link. Core draws that frame for declarative
archetypes and plugin components alike, so a plugin contributes a body and
inherits the loading, error and accessibility behaviour rather than deciding it
again. Loading marks the body busy instead of replacing it with a spinner, so a
refresh does not discard the number already on screen, and a widget that fails
keeps its title — an anonymous error box does not say which card broke.

Every visible widget's query goes out in a single request, and a widget the
current user may not see contributes no query at all. Sizes are named steps on a
twelve-column grid; below the `md` breakpoint every widget is full width, which
the previous plugin grid got wrong.

Only the `metric` archetype renders in this release. The rest report themselves
as not yet drawn rather than coming up blank, and a payload that does not match
its archetype says so rather than being silently coerced into a number.
