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
`FieldShell` for their label, description and error wiring.

`FieldShell`'s `children` now also accepts a function —
`(field: FieldShellRenderProps) => ReactNode`, `FieldShellRenderProps` newly
exported — receiving the `{ id, describedBy, invalid }` it computes so a
caller can apply that wiring to a nested element instead of relying on a
single top-level `cloneElement`. This is what a compound Radix control needs:
`Select`'s root destructures a fixed prop list and never forwards the rest,
so an id cloned onto it never reaches the real, focusable `SelectTrigger` two
levels down — silently, with no error and no warning. Both call paths derive
their id/`aria-describedby`/`aria-invalid` from one shared computation, so
they cannot drift into disagreeing about the same field. In development,
`FieldShell` now also checks after mount whether the id it computed landed on
any element in the document at all, and warns once, by field name, if it did
not — the general form of the defect a compound control's dropped id was a
specific case of. Every `Select`-driven field in the form builder's Create/
Edit view and its Notifications sheet (Status, Email provider, Email
template, Send-to type, Recipient address in field mode, Reply-To mode,
Reply-To visitor-field in field mode, and the send-condition Field and
Comparison pickers) now goes through `FieldShell` using this render-function
form, wiring their `SelectTrigger` correctly for the first time. `RadioGroup`,
`AddressChipList` and the horizontal label-left/control-right rows
(`SettingRow`, the Enabled toggle) stay hand-rolled for their own, unrelated
reasons, each documented at its own call site.
