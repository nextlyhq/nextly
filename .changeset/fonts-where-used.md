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

The Fonts screen says where each font is used, keeps the Body and Headings fonts from being removed, and asks how to use a font once it's added.

- **Where it's used:** a font's details list "Body font" and "Headings font" where it is one, and "Used in N places" for the site's font variables that name it first. The count comes from the same usage count the Variables rows show. In the builder each is a link: a role goes back to Type with its picker focused, and the count opens the font variables.
- **Removing a font in use:** Remove refuses the Body or Headings font and says to choose another first, with a way to its picker. For a font the site's variables use, the confirmation lists each variable and what its text falls back to.
- **"Use <font> for: Body / Headings / Both / Not now":** asked in place once a font finishes adding, from Google Fonts or a file. Body, Headings or Both sets the site's font at once, the canvas follows, and a toast says "<font> is now your headings font" with Undo. Not now leaves it in every font picker.
- The admin's Fonts page puts its screen in the same Variables studio as the builder, so it says and does the same.

New `@experimental` props on `FontsPanel` and `FontsScreen` (`@nextlyhq/builder/shell`): `usage`, `onOpenRole`, `onTokensChange` and `suppliedText`. All are optional, so existing hosts are unchanged.
