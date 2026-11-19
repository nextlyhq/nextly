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
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

The SEO Problems table fits its card at every width. Where the list is narrower than 64rem,
as it is in a 1024px or 1280px window, the Where, Pages and fix columns were drawn past the
card's edge and cut off. There the table now keeps Severity and Problem, and each problem says
where it is ("Whole site", "12 pages") and its fix under its own words. From 64rem the table
keeps every column, and a problem's words leave the other columns their room. A narrow screen's
cards are as before.

A plugin's numbered menu item names what it draws. The sidebar drew an item's label and its
number with no space between them, so "Problems" and "3" read as one word, "Problems3", which
the item's name ("Problems: 3") never says: axe's Label in Name check failed it, and so would a
person using speech input who says what they see. A space now separates the two, for counts and
badges alike.

On a phone, a word too long for a problem's card, such as an environment variable a message
names, now breaks inside the card instead of running past its edge.
