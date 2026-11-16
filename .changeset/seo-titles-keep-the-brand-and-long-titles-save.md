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

SEO plugin fixes for titles, lengths, share images and installing:

- A title pattern that goes on after `{Site name}`, such as `{Title} | {Site name} Blog`, now always keeps the site's name: "Why we chose Acme" gives "Why we chose Acme | Acme Blog" rather than "Why we chose Acme Blog". The name is left out only where the pattern ends with it and the title already ends with the name.
- `metaTitle` and `metaDescription` save at any length. Search engines cut a long title or description to fit rather than refusing it, so the SEO tab and the problem list warn with the length (`68 characters, Google shows about 60`) instead of the save being refused. Pass `seoPlugin({ hardLengthLimits: true })` to refuse a title over 60 characters or a description over 160, as before. On a site that already has the plugin, the two fields' changed settings are a schema change like any other: run `nextly migrate:create`, and `nextly migrate` where you deploy, before a longer title saves there.
- A share image in a format some networks don't show on a card (SVG, AVIF or WebP) is named in the problem list and the SEO tab, fixed by making a share image, which is a JPEG.
- `@nextlyhq/plugin-sdk` is now a dependency of the plugin rather than a peer, so it is installed with the plugin and a site can no longer leave it out of a production install. A client secret wrapped by a site's own copy of the SDK is still read.
