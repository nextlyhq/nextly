---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Tidy up the admin sidebar.

The Settings panel now lists system configuration before user administration,
and its groups are declared as data, so a group's heading appears only when it
actually has something under it.

On the dashboard, the collapsed secondary panel no longer draws a stray second
line beside the icon rail, and no longer nudges the page a pixel to the right.

The built-in Nextly mark sits on a rounded tile in the sidebar and takes its
colours from the theme in both light and dark mode. A logo you have configured
yourself is left exactly as you uploaded it.
