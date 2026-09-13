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

The two disagree in both directions. A code-first config reserves names like
`admin` and `dashboard` because such a collection is mounted on a route, and
nothing on the runtime create path consults that list — so a key stamped
`read-admin` can create `admin` and read it, and was being refused the step it
could finish. In the other direction a code-first slug may contain hyphens while
a runtime slug may not, so a key stamped `read-team-updates` was being offered a
step no create path would let it complete.

The rule a create enforces on every path is now declared once, in
`domains/collections/creatable-slug`, and the schema endpoint's own slug
validation reads it from there rather than restating it.

An app that cold boots only through `createDynamicHandlers` now seeds its preset
roles as well as its permissions. That path re-seeded permissions on the first
request but never re-resolved the presets, so an administrator who was not a
super admin never received a new collection's grants there, however many times
the app restarted. The two are now one boot operation that both paths call,
which is the same fix this module already carries for plugin-declared
permissions.
