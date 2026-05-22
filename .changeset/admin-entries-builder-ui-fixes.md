---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/ui": patch
---

Admin UI polish across the Entries forms, Schema Builder, sidebar, and global loaders.

Field width is now respected end-to-end. `packFieldsIntoRows` no longer treats `group` as a block-only field, so groups participate in the same row-packing as regular fields and honour `admin.width` on both the builder canvas and the entry form. `FieldRow` adds a synthetic spacer column when a row's declared widths sum to less than 100% so partial-width fields keep their authored size instead of stretching to fill, and uses `items-start` so adjacent fields of different heights align cleanly. `NestedFieldGroup` in the schema builder uses the shared `packIntoRows` / `parseWidth` helpers to render nested children in the same row layout as the top-level canvas; `repeater` and `group` containers are forced to full width to stay readable. `ComponentRow` and `GroupInput` now delegate to `FieldRow` + `packFieldsIntoRows` instead of mapping each child through `FieldRenderer` directly, so nested component and group fields lay out consistently with the surrounding form. `pack-fields-into-rows` also guards against `undefined` / non-array `fields` input.

Entries table no longer shows the `id` column by default. `getDefaultVisibleColumns` keeps `id` available in the column toggler but excludes it from the initial visible set, matching the rest of the admin's "title first" presentation.

Schema Builder toolbar is now sticky. `BuilderToolbar` sticks to the top of the builder viewport (`sticky top-0 z-30`) with a solid background so it stays visible while scrolling long field lists; the collection / single / component builder pages were restructured to render the toolbar outside `PageContainer` so the sticky positioning has the correct scroll parent, and the container drops its bottom padding to remove the gap underneath.

Sidebar no longer flashes the empty / unauthorised state during hydration. `DualSidebar` now treats `!isHydrated` as part of `hasPermissionDataPending` (alongside the existing permissions-loading / error checks), so menu groups render their loading skeletons until the router and permissions are both ready instead of briefly showing nothing.

`PermissionGuard` loading state is replaced with a branded loader: a glassmorphic card with an ambient glow, the shared `Spinner`, and the Nextly brand mark animated via two new global keyframes (`brand-orbit`, `brand-pulse`) added to `globals.css`. A `?debug_loading=true` query param force-enables the loading view to make iteration on the loader easier. Auth setup / reset-password / user-management / email-provider secret-field inputs get small consistency tweaks alongside the same loader treatment.
