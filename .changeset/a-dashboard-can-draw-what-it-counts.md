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

A dashboard could count and group entries but had no way to show either as a
picture. Every chart meant writing a React component, which is how a dashboard
stops looking like one product.

Two archetypes now draw from a query the way `metric` and `table` already do,
so an author declares a chart instead of shipping code: `bars` compares the
buckets of a `groupBy`, and `timeseries` plots the points of a window.

They are drawn here rather than by a charting dependency. The popular one pulls
eleven packages — a state-management stack in every install's admin bundle for
two shapes — and renders `role="application"`, which puts a screen reader into
forms mode over a graphic that has no keyboard interface. Owning the markup is
what makes the right pattern reachable: each chart is a labelled graphic with a
text alternative naming what it shows, beside the same numbers as a real table.

The bars run horizontally because their labels are whatever the grouped column
holds — author names, tags, statuses — and a column chart has only its own
width for those, which forces rotation or truncation. A capped bucket set says
so rather than presenting a partial comparison as the whole one, and a
timeseries labels each point in UTC, the zone its buckets were computed in, so
the axis cannot name a different day than the server did.
