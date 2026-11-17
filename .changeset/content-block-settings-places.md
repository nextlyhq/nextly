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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The content blocks' settings are in the places and words the block panel uses for
every block. A link's relationship is in Advanced › HTML on every block that links,
and the new-tab switch reads "Open in a new tab". A Heading links to an entry as a
Button does, in its own Link section, and renders at once unless it links to one. A
Button's type is "Button type" in Advanced, and its accessible label "Screen reader
label". A List's kind is "List as: Bullets / Numbers", "Start at" shows only for
Numbers, and a custom marker is added from "Add CSS property". Quote, Embed, Rich
text and Table of contents read plainer. A Button and every container gain a shadow, a
Heading and a List a background, and a Divider no longer offers a text colour. A
block's prop can now say it applies only to some values of another (`onlyWhen`).
Nothing stored is renamed: pages render as they did.
