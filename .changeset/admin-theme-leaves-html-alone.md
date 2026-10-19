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

The admin no longer writes its theme onto the host app's `<html>`, so an app whose root layout is the one `create-next-app` writes no longer logs a hydration mismatch on every admin page. The theme, light, dark or system, is applied to the admin's own containers, its dialogs and menus included, before the first paint, so a dark admin no longer flashes light on load. Native controls such as scrollbars and inputs follow the admin's theme.

`ThemeProvider` and `useTheme` from `@nextlyhq/admin` keep their names and the `nextly-theme` storage key, and a `ThemeProvider` inside another still defers to the outer one. `ThemeProvider` now accepts `defaultTheme`, `storageKey`, `enableSystem`, `forcedTheme` and `nonce`; next-themes' other props, such as `attribute` and `disableTransitionOnChange`, are no longer accepted, since the admin no longer depends on next-themes. `useTheme` returns `theme`, `setTheme`, `resolvedTheme`, `systemTheme`, `themes` and `forcedTheme` as before.

A site with a nonce-based Content Security Policy passes its nonce to `RootLayout` (`<RootLayout nonce={nonce} />`) or to `ThemeProvider`, so the admin's small pre-paint script is allowed to run.
