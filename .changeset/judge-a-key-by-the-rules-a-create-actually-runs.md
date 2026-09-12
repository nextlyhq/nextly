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
"@nextlyhq/plugin-mcp": patch
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

The onboarding checklist now judges an API key's read grant by the rules a
collection create actually runs, rather than by the code-first config validator.

The checklist links its step to the Schema Builder, whose create posts to
`POST /collections` and validates the name with `collectionNameSchema`. That
schema's verdict is therefore whether the step can be finished, and the
code-first validator disagreed with it in both directions: it reserves `admin`
and `dashboard`, which the Builder creates happily, and it allows hyphens, which
the Builder does not. So a key stamped `read-admin` was refused a step it could
finish, and one stamped `read-team-updates` was offered a step it could not.

The predicate now asks `collectionNameSchema` itself rather than restating any
rule, so a reserved name or a length limit added there reaches the checklist with
nobody editing a second file. That also brings in two refusals no restatement
had: SQL keywords such as `select`, and the Builder's own reserved names such as
`accounts`.

An app that cold boots only through `createDynamicHandlers` now seeds its preset
roles as well as its permissions. That path re-seeded permissions on the first
request but never re-resolved the presets, so an administrator who was not a
super admin never received a new collection's grants there, however many times
the app restarted. The two are now one boot operation that both paths call,
which is the same fix this module already carries for plugin-declared
permissions.
