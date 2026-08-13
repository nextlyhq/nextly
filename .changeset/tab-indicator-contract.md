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

Tabs now look the same everywhere.

The admin's tab strips are an underline control: the active tab is marked by a
bottom border, and the tab is square so that border runs flush to its edges. The
shared component already draws all of it — the underline, the active and hover
colours, the focus ring.

Several first-party plugin screens were drawing their own instead. The form
builder switched the underline off and repainted it from React state through an
inline style, three field-editor tabs restated the whole indicator, and a few
places re-declared a square corner the component already guarantees. The result
was the same component wearing a different appearance depending on the screen.

Those screens now pass layout only and let the component draw the indicator, so
the page builder's inspector, the form builder, its field editor, its preview
and its submissions list all match the rest of the admin. Layout overrides stay
allowed, because a tab strip in a dialog is a different shape from one in a
sheet.

A test reads every first-party call site and reports one that repaints the
indicator, so the next screen to do it is caught in review rather than noticed
later. It reads what a call site is written as, which is not the same as
guaranteeing the appearance cannot be forked: a class arriving from another
module, through a prop spread, or through a slotted child is not something it
can see. The component stays deliberately overridable so a theme can move these
values, and that is the same door a call site can walk through.
