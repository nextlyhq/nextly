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

A composition plan now carries warnings, and converting a run to a component reports the anchors it will leave behind.

Converting moves a run's nodes into a definition, and composition scopes every definition-authored DOM id per instance — it has to, because two instances of one definition cannot both answer to one `id`. An author who wrote `id="pricing"` on a section, with `href="#pricing"` in a nav elsewhere on the page, was left with a link that resolved to nothing and no indication of why.

`CompositionPlan` gains a required `warnings` list. A warning rides alongside a successful plan and never refuses it: nothing here is invalid, no scoping rule makes one id serve many instances, and the author may want the component anyway. The field is always present and empty rather than optional, so a surface has one value to handle instead of two — and it is on the plan rather than in a surface because the plan is the dry run, and the second surface to offer the same action would otherwise have to remember to ask.

A reference from inside the run is not reported: it moves with the run and the relink pass rewrites it.
