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
"create-nextly-app": patch
"nextly": patch
---

Arrange your own dashboard.

An "Edit dashboard" button turns the grid into edit mode: drag a card, or move it
with buttons, hide one without losing where it sat, remove one entirely, and add
back anything you are missing. Save commits the arrangement; Cancel discards it;
Reset puts you back on the default and keeps you tracking it, so a widget added
later still reaches you.

Every change is held locally until you save. Each write is guarded twice -- by a
version that catches another tab, and by a token that catches the set of widgets
available to you moving underneath what you are looking at -- and both refuse the
same way, with a message and a Reload rather than a silent overwrite. Your work
stays on screen while you decide.

Moving a card never requires a drag. Move up and Move down are ordinary buttons,
because WCAG 2.2 requires a single-pointer alternative to every dragging movement
and a keyboard shortcut does not satisfy it. Reorders are announced through the
grid's existing live region.

The dashboard also stops depending on the arrangement being reachable: if it has
not loaded, or cannot load, the cards draw in their declared order exactly as
before rather than leaving the page blank.
