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

The builder's Advanced → Visibility now says "Hide on", with one toggle per device the site defines, each with its icon and its name, pressed where the block is hidden, and the line "Hides only on the devices you pick, not smaller ones." Pressing a device hides the block there alone; what is stored is unchanged. Hovering a toggle shows the CSS it writes, such as `display: none at 768–1023px`.

While a block is hidden on any device, the top of every inspector tab says so ("Hidden on Mobile. Visitors on that device won't see it."), with "Change" to go to Hide on from Content or Style. On the canvas, at a device the block is hidden on, it is still drawn, striped and tagged "Hidden on Mobile · still here in the builder", and plain at the other devices; "Preview as visitor" and the published page show nothing of it. In Layers, a row hidden on another device shows an eye-slash whose tooltip names the devices.
