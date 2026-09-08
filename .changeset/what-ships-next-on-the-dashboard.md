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

The dashboard can show what ships next: `system:releases` is the first widget
source answered by a domain service rather than compiled to a collection query.

Asking for it honestly needed one change underneath. `findReleases` ordered
recent-first, which is right for "what happened" and wrong for "what is coming":
a limited query for the next few releases returned the FURTHEST OUT ones, with
real rows in a plausible order and nothing in the result to say so. It now takes
an `order` option, defaulting to the existing recent-first behaviour so no
current caller changes, and NULLS LAST is stated in both directions — the
default differs per dialect, so an unscheduled draft would otherwise be the
"next release" on some databases and not others.

The card asks a fixed question and refuses a `where` or `sort` rather than
accepting one and discarding it, publishes three of the release row's eleven
columns, and hands the releases service the caller so that service's own
`authorize` remains the only rule deciding which releases anyone sees.

Two fixes to the source machinery itself. `POST /api/dashboard/query` decided a
system source was usable from its KIND alone, which admitted one nothing had
registered a resolver for — and every message past that point is specific, so an
undeclared field was answered in detail for a registered source and generically
for an invented one, distinguishing the two. The endpoint now asks the executor
the same question the executor asks, from one shared implementation. And the
boot-time registry reset cleared the widget sources without clearing their
resolvers, so a removed or renamed system source left its resolver addressable
for the process lifetime, holding whatever its closure captured.
