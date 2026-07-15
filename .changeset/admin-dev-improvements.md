---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Keep the schema builder out of production, isolate the admin design system from the host site, and fix admin surface consistency.

**The schema builder is now off in production, and its endpoints enforce it.** `admin.branding.showBuilder` already hid the builder's navigation, but the schema endpoints behind it stayed open — a deployed site would still accept requests to create, alter, or drop collections, singles, and components over HTTP, straight against the live database with no migration to review and no rollback. Those endpoints now refuse with `403 BUILDER_DISABLED` wherever the builder is disabled, the builder's pages send you back to the dashboard instead of loading, and the schema-changes bell is hidden. The builder is disabled in production by default; set `admin.branding.showBuilder: true` to opt back in.

Reading schemas, entry CRUD, and code-first schema sync are all unaffected — a deployed site still lists its collections and manages its content exactly as before. **If you script schema changes against a production deployment over HTTP, that now returns 403** and is the one thing to check before upgrading.

The admin's design tokens are now namespaced (`--primary` is now `--nx-primary`, `--background` is now `--nx-background`, and so on) and the admin's scoping wrapper is now `.nextly-admin` (was `.adminapp`). Utility classes are unchanged: `bg-primary`, `text-muted-foreground` and friends keep working exactly as before. This means a site's own `--primary`/`--background` tokens can no longer collide with the admin's, and the admin can no longer restyle the site around it.

Also fixed: the admin's CSS reset (`html`/`:host` font and line-height, file-input and form-element rules) leaked onto the host page instead of staying inside the admin; `dark:` utility variants were silently corrupted during CSS scoping and now work; a stray selector gave focused inputs the browser-autofill treatment; and the dark-mode sidebar now shares one flat surface with the content instead of appearing as a lighter panel.

If you wrote custom CSS targeting admin internals, reference the `--nx-*` token names and the `.nextly-admin` wrapper.

Removed the unused `ResponsiveTable` (and its `Column` type), `BulkSelectCheckbox`, and `RoleAssignDialog` exports. Every admin list already renders through the unified `DataTable`, and none of these were used; if you were importing `ResponsiveTable`, use `DataTable`/`DataTableView` instead.

There is now one pagination component. The admin had grown three — the shared `Pagination`, an entries-only copy, and a `TablePagination` in `@nextlyhq/ui` that no table used — which is why pagination sat flush against the table on some pages and floated with a stray border on others. The surviving `Pagination` gained the better parts of the others (a `<nav>` landmark, arrow/Home/End keys, a configurable item noun) and its buttons now use the interactive border tier instead of the faint divider tier. `TablePagination` is removed from `@nextlyhq/ui`; use `DataTable`, or `Pagination` from `@nextlyhq/admin`.

Menu items in dropdowns now show a pointer cursor and a readable hover, and the highlight follows keyboard navigation as well as the mouse.

Table column choices now survive a refresh, and "Reset to default" restores the collection's real default columns. Both were the same fault: the admin saved a placeholder set of columns over your stored choice before the collection had finished loading.

Profile changes now show in the header straight away instead of after a reload, and save buttons are text-only — dropping the floppy icon also fixed their spacing on the settings pages.
