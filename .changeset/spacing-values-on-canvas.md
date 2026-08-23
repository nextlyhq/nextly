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

feat(builder): draw the selected block's margin and padding on the canvas

An author sets spacing in the inspector and looks at the canvas, where until now
nothing said what a value did — the only way to see it was to change it and watch
the layout move. The selected block now carries a band over each side that has
spacing, with the value written on it: amber outside for margin, green inside for
padding, which is the palette browser developer tools have used for years.

The values are read from the RENDERED element rather than from the stored style
tier, because that tier cannot answer the question. The catalog stores spacing per
LOGICAL side and a band is drawn on a physical one; `auto` has no value until
layout runs; a percentage resolves against the containing block; and a named
class, a block-type default or a breakpoint override can win the cascade. Asking
the page what it is doing keeps one answer where there would otherwise be two.

Only the primary selection is measured — spacing belongs to a node, and a
multi-block selection has no margin of its own. Sides with no value draw nothing.
The bands take no pointer events and are hidden from assistive technology, whose
route to the same numbers is the inspector's Spacing section.
