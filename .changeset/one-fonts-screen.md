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

The site's fonts are one Fonts screen with three ways in. In the builder,
Design → Type "Manage fonts…" and every font picker's "Manage fonts…" open it
in the Design panel's place, with the canvas kept and no reload, and "Back to
Design" returns to the Type tab. In the admin, Page Builder → Fonts is a page
of its own for those who may change the site's design (`update-site-style`),
listed under a new Design heading after Checks. Every way in reads and writes
through the same site-style client, so a font added in one is in the others.

The Type tab no longer holds the fonts list itself: it shows the Body and
Headings fonts with "Manage fonts…" under them.

New `@experimental` exports from `@nextlyhq/builder/shell`: `FontsScreen` and
`FontsScreenProps`. `FontsPanel` is unchanged.
