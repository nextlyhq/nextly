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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The command palette is now part of the admin. It opens with ⌘K (Ctrl+K on Windows and Linux) in every app that serves the admin, with no code of the app's own, and it opens on screen, near the top of the window, at every width.

A new Search button under the logo at the top of the rail opens it too, and on a phone the Search row at the top of the menu drawer does. When the palette closes, focus goes back to where it was.

Typing finds collections, Singles, pages and actions, each under its own heading and only where the person may open it:

- **Pages:** the Dashboard, every Settings and Builders page, Account settings, and every page a plugin adds to the menus.
- **Actions:** "New <type>" for each type the person may create (it was "Create <type>"), Create user and Create role for people who may create them, and Open documentation, GitHub and Discord, minus any a plugin hides with `header.hide`.

Picking a collection opens its list and a Single opens where the Content menu would open it. Inside the Page Builder's editor, which takes the whole window, ⌘K still opens the editor's own search; once you leave the editor by its back arrow, ⌘K and the rail's Search button open the admin's.

If your app mounts `<CommandPalette />` itself, remove that mount: the admin mounts its own now. If you leave it, it draws nothing while the admin's palette is mounted, so there is still one palette and one answer to ⌘K. `CommandPalette` stays exported.
