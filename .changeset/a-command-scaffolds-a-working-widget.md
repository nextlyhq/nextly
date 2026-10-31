---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
"nextly": patch
---

`nextly generate:widget <name>` scaffolds a working dashboard widget in the site or plugin it runs in: a declaration, a component of its own for `--view component`, and a test that loads it as the instance's administrator and draws its card. Pick how it shows its data with `--view figure|list|table|bars|series|component` (a figure when left out), and whether it reads from a collection the reader chooses with `--collection`. It lists the widget in the site's `admin.dashboard.widgets` or the plugin's `contributes.dashboard.widgets` when the file has a shape it can edit safely, and otherwise leaves the file as it was and prints the line to add. A site without `@nextlyhq/plugin-sdk`, which the test imports, gets it added to its devDependencies at the running `nextly`'s version, and is told to install. It never writes over an existing file unless given `--force`, and generating a widget again leaves it listed once; `--dry-run` shows everything without writing, and on a terminal it asks for anything left out. A site's widgets are named `site/<name>`, a plugin's under its own name, with its scope in front when that name is one core keeps (`@acme/core` → `acme-core/<name>`). `nextly` gains a dependency on `@babel/parser`, which the command reads the config with to find where the widget is listed; only `generate:widget` loads it, so nothing else pays for it. `createTestNextly` gains an experimental `widgets` option, for a site's own widgets, and gives an instance booted without a `NEXTLY_SECRET` a random one, so `runWidgetLoad` works without setting it first.
