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

Two accessibility fixes in the builder's Design panels.

- A colour pair's "Low contrast" ratio in a variable's details was drawn in the
  admin's red fill colour, which read about 3.7:1 as small text. It now uses
  the admin's red text colour: 6.4:1 in the light theme and 9.6:1 in the dark.
- The rows of Fonts' font variables and catalogue, Variables and Shared styles
  carried an aria-label that replaced what they draw, while their drawn words
  included a decorative "Aa" specimen or a preview sentence. Each row is now
  named by one piece of text that only a screen reader reads, starting with
  the words it shows, and the drawn words are hidden from screen readers. What
  a screen reader says for each row is unchanged.
