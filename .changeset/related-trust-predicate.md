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
---

Relationship expansion can now be told WHICH collections a trusted read may
reach, judged per expansion target.

`overrideAccess` says the caller is trusted. It said nothing about the
collection a relationship points at — which the caller never named and may not
serve to the same audience — so a trusted read spread that trust into every
target it populated. A caller serving one fixed audience can now state its
trusted set, and anything outside it is read as that audience would read it.

Absent the new option nothing changes, so the Direct API keeps its semantics: a
caller that has already decided who is asking is not narrowed by a default it
never chose.
