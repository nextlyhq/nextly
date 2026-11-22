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

A site now has one fluid range, "Smallest screen" and "Largest screen"
(360px and 1280px by default). It is set at the top of Design's Type tab,
and reached from every "Fluid…" as "Change range".

Changing the range makes every size made with "Fluid…" again from its own
two sizes, so each still reads the same at the smallest and the largest
screen. A fluid value written by hand, the built-in spacing among them, is
left as it is. A range whose smallest screen isn't the smaller is refused in
its field, with the reason.

The range is a new optional `fluidRange` (`{ min, max }` in px) on the site's
token set, beside `prefix` and `darkMode`. The range and the sizes it remakes
are one edit, so they save, undo and redo together, under the same Design
permission as any variable. A save validates the range: two positive widths,
the smallest first. It is stored only where it differs from the code's, and
the emitter never reads it.
