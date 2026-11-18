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

An Image's settings say what a click on it does. **When clicked: Nothing / Link / Enlarge** is stored on the Image, and the link's settings (where it goes, a new tab, its relationship) show only for Link. An Image saved before the setting existed reads as Link when it has a link and Nothing otherwise, so published pages render as they did; an Image set to Nothing or Enlarge keeps its link stored and draws none. Enlarge is offered and stored; until the full-size view arrives such a picture is drawn unlinked. `whenClickedOf` (experimental, in `@nextlyhq/blocks-react/blocks`) is the one reading of the choice. The **Alt text** field shows the media library's alt text as the value in use, marked **From the media library**, until the author types their own, and **Decorative, no alt text** is a checkbox under it. The caption sits in a **Caption** section of its own.
