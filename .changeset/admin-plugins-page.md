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

The Plugins page now tells you what each plugin actually does to your app, and every plugin has a real page of its own.

**The plugins list reports honest state.** The "coming soon" banner is gone, and so are the selection checkboxes and the bulk-delete button that only ever said "not available". In their place: an Enabled/Disabled status on every row, an author and description under each name, a category badge, and status filter chips (All / Enabled / Disabled). Plugins are installed and updated with your package manager and wired in your config, so the page reports state instead of pretending to mutate it — there are no fake install, update, or uninstall buttons.

**Every plugin has a detail page.** Clicking a row opens `/admin/plugins/{plugin}` with the plugin's identity (version, author, license, category, links to its homepage and repository) and a **"What this plugin adds"** section computed from the plugin's real registrations — the collections, navigation items, admin pages, dashboard widgets, field types, permissions, and API routes it actually contributes. A disabled plugin says plainly that its data is retained but its behavior does not load.

**Plugin settings get a whole page instead of a box.** A plugin that ships a settings UI is linked from its detail page ("Open settings") and renders full-page at `/admin/plugins/{plugin}/settings`. A disabled plugin's settings UI does not load, because a form that pretends to configure inactive behavior would be lying.

**Plugin authors can now declare identity metadata.** `definePlugin` accepts `author`, `homepage`, `repository`, `docsUrl`, `license`, `category` (a controlled vocabulary the list filters by), and `tags` — mirror your package.json values and the admin does the rest. Both first-party plugins declare theirs.

Also: the sidebar's "Installed Plugins" item now goes to the plugins overview instead of whichever plugin happened to be first.
