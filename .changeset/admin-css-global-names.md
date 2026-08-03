---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
---

The admin panel's stylesheet no longer publishes names into the page that hosts
it. Its animation names and Tailwind's internal `--tw-*` custom properties were
resolved for the whole document regardless of the scoping on its selectors, so
a host defining `spin`, `fade-in` or the same `--tw-*` registrations shared them
with the admin and the later stylesheet won. Both are namespaced now, and the
build fails if either escapes again.

`@nextlyhq/ui`'s Tailwind preset keeps its named-plus-default export shape,
which the build warns about. That shape is deliberate and now says so at the
build config as well as beside the code: a preset is consumed as a value, so
`require()` has to return it, and silencing the warning would change it back.
