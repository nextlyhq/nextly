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

Plugins can now be built from the same controls the admin is built from.

Until now a plugin author could reach for a `Card`, a `Stack` and a `Grid` — and
then had nothing to put inside them. No button, no text input, no select, no
dialog, no label. The guidance was to fall back to a stylesheet of your own,
which meant every plugin that needed a button drew one that did not quite match
the admin around it: a slightly different height, a slightly different focus
ring, a slightly different blue. Those differences are what a design system
exists to prevent, and they were arriving through the one door it did not cover.

`@nextlyhq/plugin-sdk/admin` now exports the controls a settings form is
actually made of — `Button`, `Input`, `Textarea`, `Checkbox`, `Switch`, `Label`,
`Select` and `Dialog` with their parts, plus the form scaffolding `FieldShell`,
`FormSection` and `FormActions`. They are the admin's own components, so a
plugin page inherits the admin's spacing, colours, dark mode and focus
behaviour with no build step and nothing to keep in sync.

This is what Payload, Strapi and Directus all do — the extension author gets the
real component library rather than a curated subset of it.

The set stops at what an ordinary form cannot be built without, rather than
covering everything. A component that is exported becomes something plugins
depend on, and adding a name later is a much smaller event for everyone than
taking one away.
