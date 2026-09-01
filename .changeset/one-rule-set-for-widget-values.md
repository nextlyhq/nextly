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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

One rule set for widget field values, whichever channel a widget arrives by.

`registerWidget` and `contributes.admin.widgets` validate related but distinct
shapes, and the rules they genuinely share had been written twice. Four fields
had already drifted apart one at a time -- the shortcut rule, the queryless
no-query rule, `defaultOrder` and `chrome` -- each added to one validator,
missed by the other, and each time the contributed side was the more permissive.

Measuring the whole surface rather than the next instance found five more:
a blank title, a `defaultSize` outside the vocabulary (which silently rendered
the card full width), `minSize` above `defaultSize`, an unknown `defaultHeight`,
and `actions` declared on an archetype that is not `actions`.

`widgetValueProblem` is now the single rule both channels ask. Shape stays with
each channel, because they differ there on purpose: a contribution may omit
`title` and `defaultSize`, which resolution fills in.

A divergence test pins the whole relationship -- every rule both channels must
agree on, and the four differences that are deliberate, each recorded with the
reason it is not drift.
