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

Section, Box, Columns, Column, Card, Accordion, an accordion's Question, Gallery and
Collection list now have a text colour and typography under Style › Text, and every
block inside takes them unless it sets its own. A dark Section with white text makes its
headings, text, lists and links white. Headings keep the size and line height Site text
gives them. Links take the container's colour while the site's Links row sets no colour;
once it sets one, that colour wins everywhere. A block's own colour, a block style and a
shared style still win over the container's.

A new Section's Style › Spacing now says where its padding comes from: "Site default:
Section spacing", with each side named by the variable it reads.

Compatibility: containers may now carry colour and typography, and a page compiles one
more zero-specificity rule for the links inside each container with a text colour. A
host stylesheet that colours `a` itself beats that rule. Every page's stored stylesheet is
compiled again once, on its next read, so pages saved before pick the rule up. The Collection list's pager no
longer colours the gap between its page numbers; it takes the colour of the text around
it.
