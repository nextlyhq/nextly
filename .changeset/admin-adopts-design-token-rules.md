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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The admin and `@nextlyhq/ui` now enforce the same design-token rules shipped to plugin authors.

Twelve inline styles became utility classes, so those surfaces follow the theme and the spacing scale rather than fixed values. The page-builder drop indicator was painted a fixed `deepskyblue` that ignored light and dark mode entirely; it now uses the primary token.

The email preview's palette is named in one place and documented as deliberately literal — mail clients do not resolve CSS custom properties, so a preview built from admin tokens would show authors something recipients never receive.

A `design-lint-ok` exemption now annotates the construct it precedes rather than a single line, so a multi-line declaration needs its reason recorded once. The reach is bounded and cannot extend past a function.
