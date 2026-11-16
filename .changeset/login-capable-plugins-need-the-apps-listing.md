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

A plugin that can finish a login now needs the app's listing as well as its own declaration. An enabled plugin that declares `capabilities.auth.login` — or contributes a `determineUser` auth hook, which decides who is signed in — without being listed in `auth.loginPlugins` refuses to start, naming the plugin and the `auth: { loginPlugins: [...] }` line to add. A disabled plugin is not checked, and a listed name that matches no installed plugin grants nothing while boot warns about it. `ctx.auth.completeLogin` answers to the verdict the boot decided, not to a manifest a plugin edits after it starts: flipping the capability on, or renaming itself onto a listed plugin, grants nothing. Apps that already list their login plugins in `defineConfig({ auth: { loginPlugins } })` are unaffected; an app whose login plugin only declared the capability now adds the listing to `nextly.config.ts`.
