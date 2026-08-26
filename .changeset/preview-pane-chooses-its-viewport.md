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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

The in-admin preview pane can now be shown at a chosen viewport width instead of
whatever width the editor happened to leave it.

This matters more than it sounds. The pane sits in a split that reserves a
minimum editor, so at its default position the preview is a few hundred pixels
wide — which means it was faithfully previewing a MOBILE viewport, decided by
wherever the divider was last dragged rather than by anything anyone chose. The
two controls were also coupled: widening the preview meant narrowing the editor
being typed into.

Choosing a width now does two things in order. The split gives the preview as
much room as the minimum editor allows, and only whatever still does not fit is
scaled down. On a wide window nothing is scaled at all.

A scaled frame keeps its requested width, so the site's own media queries still
resolve against the viewport being previewed and the preview stays truthful
about layout. What it stops being truthful about is physical size — text renders
smaller than a visitor would see it — so the toolbar always states the real
width and the scale beside it rather than letting the shrinking pass unremarked.

This release ships the control with **Responsive** and a custom width. Named
presets follow: they will come from a collection's own declaration where one
exists, and from the site's page-builder breakpoints otherwise, so a preset can
never disagree with the breakpoints the site actually uses. No phone/tablet/
desktop numbers are invented here, and there are deliberately no device icons —
a site names its own breakpoints, and no glyph is honest for a tier an author
called "Kiosk".
