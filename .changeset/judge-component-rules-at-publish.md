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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

Publishing a collection entry now judges each component (field-group)
instance it holds against the rules on that component's own fields, as they
are now: a `required` field, a length or range rule, a custom `validate`. An
instance is judged when it is written, so a rule added or tightened since then
let an instance that no longer meets it go live. The publish is now refused with
a validation error that names the field inside the component (`hero.code`).
This holds for a status-only publish, a bulk publish, publishing every language
at once, promoting a pending change, and a scheduled release's readiness. On a
localized collection the rules are judged for the default language only, as a
required component is.

Compatibility: an entry whose stored component instance breaks a rule on one of
the component's fields can no longer be published until that field is fixed.
