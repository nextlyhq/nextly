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

The block panel finds a setting by name. "Find a setting", under the tabs on every tab,
matches a setting's label, its section, its options, the CSS it writes and common other
words for it ("color", "corners", "nofollow"), ignoring case, accents, hyphens and camel
case.

- The tab you're on shows only what matches, under opened sections, and each tab's label
  counts its matches. A tab with none links to the tabs that have some.
- "/" jumps to the field, and Escape or ✕ clears it, giving back the sections as they
  were. The search stays across selections.
- "Only changed" keeps only what the block holds a value for. In Style, a line says
  where else it holds styles ("Also changed on Tablet (2) · Hover (1)"), with links to
  each.
- A screen reader is told how many settings were found, once typing pauses.
