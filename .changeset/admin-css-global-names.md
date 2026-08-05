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

The field-UI kit gains `ConditionRow` (@experimental), exported from
`@nextlyhq/plugin-sdk/admin` alongside `operatorsForType` and
`operatorTakesValue`. It edits one condition as source / operator / value,
choosing the operators and the value editor from the source field's type, and a
source carrying an option list is compared against a dropdown of exactly those
rather than free text. It owns the row and not the container, so a surface keeps
its own chrome; pass `operatorsFor` to narrow the offered operators to the ones
your runtime can evaluate.

Both first-party condition editors now compose it. The schema builder's gains
nothing an author will notice beyond the value dropdown; the form builder's
gains type-aware comparisons, a dropdown for choice fields, and typed number and
date inputs. Stored shapes are unchanged in both, including the form builder's
`comparison` key and its seven-comparison vocabulary.
