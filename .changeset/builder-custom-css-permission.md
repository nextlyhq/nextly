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
---

Field access rules can ask what the caller is granted, and custom CSS is now a privilege.

A field's `access.create` / `access.read` / `access.update` function now receives
`permissions` and `roles` alongside `req`, so a field can be gated on a permission
rather than only on a role. Collection-level access already received these; field
level did not, so "only these people may write this field" was not expressible.
The grants are resolved once per operation and only when a rule actually runs, so
an entity with no field rules makes no extra lookup. A rule that cannot read the
grants denies rather than opens.

`permissions` uses the same `resource:action` spelling collection-level access
uses. Note this differs from the `action-resource` form the database and the
admin's permission matrix show for the same row.

The page builder's per-page and per-block custom CSS now requires a new
`write-builder-custom-css` permission. Without it the CSS already on a page stays
visible and keeps applying, but cannot be changed — the field is dropped from the
write rather than the write being rejected, so everything else on the page saves
normally. Grant it to any role that should keep authoring custom CSS.
