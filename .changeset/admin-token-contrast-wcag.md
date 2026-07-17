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

Admin theme colors now meet WCAG 2 AA contrast in both light and dark mode.

Several `--nx-*` design tokens sat below the accessibility minimums: borders and input outlines were nearly invisible against their surface (as low as 1.2:1, where 3:1 is required), and white text on the destructive and success buttons fell short of the 4.5:1 needed for text. These are retuned to clear the thresholds. The most visible change is borders: hairline dividers become distinct medium-contrast lines throughout the admin. A new check runs on every build to keep every rendered text and boundary token pair at or above its WCAG minimum, so this cannot silently regress.
