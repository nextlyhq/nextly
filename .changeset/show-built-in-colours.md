---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

The page builder's Colours tab ends with "Show built-in colours", a site setting that is on by default and saves at once for every author. Turned off, each built-in colour nothing on the site uses is left out of the Colours list and out of every colour picker in the builder. A built-in colour the site uses stays listed, marked "Built-in", and a hidden one is listed again as soon as something uses it. Hidden colours are never removed: every one is still written on the canvas and on published pages, so core blocks such as the Card and the Button look exactly as before.

- `@nextlyhq/blocks-engine`: `SiteTokenSet` gains an optional, display-only `builtInColoursShown` boolean (`@experimental`), kept by `resolveSiteTokens`. The compiler ignores it, so no published CSS changes.
- `@nextlyhq/plugin-page-builder`: the stored site style keeps the setting (only where it differs from the site's code), refuses anything but `true` or `false`, merges it like the other site-wide settings, and names it in a save conflict. Changing it needs the same Design permission as any variable change.
- `@nextlyhq/builder`: the checkbox and its hint, the "Built-in" mark, and from `@nextlyhq/builder/shell` the `HiddenColours` context and `useHiddenColoursRead` (both `@experimental`), which a host provides around the shell so every colour picker leaves the same colours out.

No migration: a stored site style without the setting reads as "shown".
