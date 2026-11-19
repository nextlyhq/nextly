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

What an existing site notices after this upgrade, in one place:

- **Pages open in the Page Builder.** A page clicked in the Pages list, in a row the list's search found or on the dashboard's Continue card opens straight in the builder, and so does an entry of any collection whose main field is a Page Builder field. Old links to a page's form still open the form. To keep a collection opening as a form, set `admin: { opensIn: "form" }` on it.
- **Singles whose main field is the Page Builder open in it too**, such as a Homepage with a title and a page layout. The same `admin: { opensIn: "form" }` on the Single keeps its form. A Single whose main field is anything else opens as a form, as before.
- **The form is one step away.** In the builder, ⋯ → "Open as form" opens the form, and the form's "Open in builder" comes back. "Edit details" in a row's menu opens the form of an entry that opens in the builder.
- **A new page is a short dialog**: "+ New page" asks for a title, shows the address made from it and the header & footer, and "Create and open builder" saves a draft and opens it.
- **Page settings is one row of tabs**: General, Fields, SEO, Code, with "Site settings" apart.
- **The entry page and the dashboard read in plain words.** An entry's address is called "Address" wherever an author sees it, the list's column included (it read "Slug"); a Single's side panel says what it is, when it last changed, where the builder shows it ("Shown on (from the builder)") and, for developers, its API path and ID; the Continue card lists your pins first, newest first, under "Pinned", then "Recent", with "View all pins".
- **Nothing stored changes.** Pins are kept as they were; only their order on the card is now newest first.

The Page Builder overview's empty "Where it is used" now says to choose Blocks in the Schema Builder rather than naming a "Blocks field".
