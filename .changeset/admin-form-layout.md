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

feat(ui): add a shared admin form layout layer

A shared form layout layer for the admin: a named field-width vocabulary for
consistently sized controls, section chrome composed from the existing card,
a single page-level action bar, and an opt-in responsive mode on the existing
grid.

`FieldShell` associates its label with whichever id actually ends up on the
control (a caller's own id or a generated one, never an explicitly-`undefined`
one), composes `aria-describedby` with whatever the control already carries
rather than replacing it, and forces `aria-invalid` when `error` is rendered
even if the control claims otherwise. It owns this prop merge itself with
`cloneElement` instead of Radix `Slot`, warns in development rather than
silently disconnecting when handed a `Fragment`, and narrows `children` to a
single element to match what it can actually slot in. `FormSection` names its
region with `aria-labelledby`. `Grid`'s `responsive` mode now splits
`className`/`style`/`ref` (parent-layout concerns) from `cols`/`gap` (internal
layout) between its wrapper and inner grid; non-responsive mode is unchanged.
