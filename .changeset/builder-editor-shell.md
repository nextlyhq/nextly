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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

add the page-builder editor shell

`@nextlyhq/builder` gains `BuilderShell` — the editor frame: an icon rail, one
switched left panel, the canvas slot, a fixed right inspector, and the bars
around them. Presentational by contract: it owns which panel is open and the
region widths, and owns nothing about the document, so selection arrives as a
prop.

Also exported: the shell's own decisions (`LEFT_PANELS`, `PANEL_BOUNDS`,
`RAIL_WIDTH`, `MIN_SHELL_WIDTH`, `MIN_CANVAS_WIDTH`) and the `PreferenceStore`
port a host implements to keep chrome preferences wherever it already keeps
preferences.

New subpath `@nextlyhq/builder/styles.css` carries the `--nx-builder-*` chrome
token layer. A consumer that renders the shell without importing it gets
unstyled markup.
