---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The block panel's Advanced tab reads plainly.

- **HTML tag** moves to Advanced › HTML on every container. Its menu names each tag once, after a plain name and what it means ("Section — a themed part of the page `<section>`"), and the closed menu reads the same. A Section has no Content tab now, since it says nothing itself. A select whose words already are its code, in other capitals, shows it once.
- **Anchor (ID)** replaces "CSS id", with the hint "Lets a link jump here: #your-id".
- **CSS classes** is a new field under it: names separated by spaces, added to the block's element. The valid names are written, and each refused one (a leading digit, `.`, `#` or `nx-`, or a character a class can't hold) is listed under the field with the reason. A name is judged once a space or leaving the field finishes it.
- **+ Add attribute** is drawn as a button. `class` typed as an attribute says "Use CSS classes above."
- **Show when** reads "Always shown" with "+ Add condition", and names whose fields its conditions read ("Each post in the list") only inside a Collection list.
- **Keep out of search previews** replaces "Never quote this" and is offered on every container (Section, Box, Card, Columns, Column, Accordion and Gallery), with the note where the chosen tag is one Google doesn't read the mark on. The SEO plugin's hint and docs name it too.
