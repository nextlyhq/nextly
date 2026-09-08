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

Let the canvas show the interaction state the style panel is editing.

A page cannot force a pseudo-class on itself, so an author switching the panel
to hover was editing an appearance nothing could show them. A preview sheet now
gives each state a class alternative beside its pseudo-class, and the canvas
puts that class on the selected block — so hover, focus and active look on the
canvas the way they will look to a visitor.

The alternative, measuring which pseudo-classes actually match, was declined:
the pointer is in the inspector whenever anyone is reading the panel, so a
measured `:hover` is false every time and every hover control would report
unset permanently.

The marker sits inside the `:where()` that already wrapped each pseudo-class, so
it carries no specificity and a previewed rule weighs exactly what the published
one weighs. Published sheets do not ask for it and are unchanged.
