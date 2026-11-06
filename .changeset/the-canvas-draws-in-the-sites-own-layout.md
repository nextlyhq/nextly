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

The page builder's canvas can draw the page inside your site's own layout, so your app's global stylesheet, fonts, header and footer are around it, as they are around the published page.

Add a route, inside the layouts your pages are published in, whose page is the new `PageBuilderCanvas` from `@nextlyhq/plugin-page-builder/canvas`, and name its path as the new `canvasPath` option, for example `pageBuilder({ canvasPath: "/page-builder-canvas" })`. The editor loads that page into the canvas and draws the page being edited in it. Your layout stays visible around the page, faded and inert, so its links and forms do nothing in the editor; pointing at it shows that it is part of your site's layout.

`canvasPath` must be a path on the admin's own site; a full or protocol-relative URL is refused when the plugin is configured. A site whose pages sit under their language writes `{locale}` where the code goes, for example `"/{locale}/page-builder-canvas"`, and the editor loads the route for the language being edited, leaving the segment out for the default language. Without it, the canvas draws on its own blank page as before. When the route is set but not found or does not load, the canvas does the same, and a note above it says so, with a link to the docs.

On the blank page, the canvas's stand-in base styles (no body margin, a light ground, and the site's ink and body font on the canvas) still apply. On your site's page, your own stylesheet decides them instead. The canvas also states the direction of the language being edited, as `dir` beside `lang`.

`CanvasFrame` from `@nextlyhq/builder/shell` takes a `source` that is either the editor's blank page or a page the site serves, and reports through `onSourceFallback` when that page cannot be shown. Both are experimental. **Compatibility:** the experimental `CanvasFrameSource` type is now the union of `BlankFrameSource` (its previous shape: `srcDoc`, `ready`, `mountPoint`) and the new `SiteFrameSource` (`src`, `served`, `ready`, `mountPoint`, `watch`). Code that read `srcDoc` from a `CanvasFrameSource` narrows first with `"srcDoc" in source`, or types its value as `BlankFrameSource`.
