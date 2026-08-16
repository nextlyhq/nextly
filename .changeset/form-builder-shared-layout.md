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

Put the form builder's Create/Edit view on the shared form-layout components
(`FormLayout`, `FormActions`, `FieldShell`, `Grid`) from `@nextlyhq/ui`.

The view no longer hand-rolls its own card, page padding or a negative-margin
hack to escape that padding; `FormLayout` owns the measure. The submit and
cancel actions moved into one `FormActions` bar at the end of the page, fed the
form state's existing dirty flag instead of a second, separately-rendered
unsaved-changes indicator. The Settings and Notifications tabs no longer cap
their own width, so they fill the page measure instead of sitting narrower
than it. The Notifications sheet's two-column rows moved off a viewport
breakpoint onto `Grid`'s container-query mode, since the admin content region
is narrower than the window whenever both sidebars are open.

Simple single-element fields (plain text/email inputs) now render through
`FieldShell` for their label, description and error wiring. Fields built on a
compound control (Radix `Select`) stay hand-rolled: `Select`'s root does not
forward arbitrary props to its trigger, so a wrapper that clones a single
child to attach `id`/`aria-describedby` has nothing to attach them to.
