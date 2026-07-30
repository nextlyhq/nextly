---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
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
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

The admin panel moves User Management into the Settings section.

The standalone Users icon in the main icon rail is removed. Users, User Fields,
and Roles — and any plugin collections placed under the former "users" section —
now appear under a new "User Management" group at the top of the Settings
sub-sidebar. Visiting /admin/users or /admin/security/roles now highlights the
Settings icon and opens its sub-sidebar.

These routes are now treated as part of Settings throughout: the page
breadcrumbs on Users and Roles pages nest under a Settings parent crumb
(Dashboard › Settings › Users › …), matching the other Settings pages.

A role whose only access is to users or roles still sees the Settings icon, and
clicking it lands on /admin/users (or Roles) rather than redirecting away from
the manage-settings-guarded General page.
