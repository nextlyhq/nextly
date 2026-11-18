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

The Table of contents lists the page's own headings. It builds its list from the
headings the page draws, in page order (Heading blocks, the headings inside Rich text
and, on a collection template, the entry's own body), so there is nothing to fill in and
the list follows every heading added, renamed or moved, on the canvas at once. Each link
uses the id the page draws its heading with, so two headings with the same words can no
longer send a link to the wrong one. It leaves out the site's header and footer,
headings inside a Collection list or an Accordion, headings hidden on every device, and
any heading left out of the table of contents.

New settings: "List as: Numbers / Bullets" (new blocks number their entries 1, 2, 2.1
with CSS counters, which a screen reader does not read twice) and "Highlight the section
being read" (on by default: in browsers with CSS scroll-linked targets the entry for the
section in view is set heavier, with no script). Each link is now a 44px target. With no
headings to list, the canvas says "Add H2 headings to this page and they'll be listed
here." and the live page draws nothing.

This changes the published HTML of every page with a Table of contents, and the block's
stored shape: it is now version 2, and a migration runs when a page is read. A version 1
block is upgraded: its bound `content` is dropped (it is no longer read), its other
settings are kept, and it draws bullets, as it drew no numbers before. A binding left on
`content` fills nothing, and the bindings report names it. Each heading of the
`@experimental` page outline on the render context gains `listed`.
