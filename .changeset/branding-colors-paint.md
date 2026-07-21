---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin-css": patch
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

Fix custom admin branding colors, which made branded surfaces transparent instead of applying the configured color.

Setting `admin.branding.colors` did not tint the admin — it broke it. Buttons, the active navigation item, focus rings and the first chart series lost their background entirely and rendered transparent. Removing the setting was the only way back to a working admin, so the feature was effectively unusable.

The admin's design tokens hold complete colors and are read directly, but branding was still resolving colors to the bare `H S% L%` form an older token scheme expected. That produced an invalid value, which browsers discard. The server-rendered stylesheet that exists to prevent a flash of unbranded color had drifted further still, targeting a CSS class the admin no longer renders and writing token names nothing reads, so it had no effect at all.

Branding now resolves to complete colors on both paths, and the server-rendered rule targets the class the admin actually uses, so configured colors appear immediately on load without a flash.
