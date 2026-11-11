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

The SEO plugin's social cards now state everything a network reads from them:
the site's name, the page's language, and the share image at its full
address, with its width, height and alt text. A share image the media library
stores with a path from the site's root (`/uploads/cover.jpg`) is stated on
`baseUrl`, since a network reading the card cannot load a path. The site's
name and language come from the new `socialCard: { siteName, language }`
option; a page the route read in a language states that one.

A share image narrower than 1200 pixels, or whose width is not 1.8 to 2.0
times its height, is reported by `shareImageProblems(ctx, input)`, with where
it is fixed, and `shareImageSizeProblem({ width, height })` answers the same
for one picture. The plugin's new `POST /share-image` route makes a copy of a
media library picture at 1200 × 630, cut around its focal point, as a JPEG
under 600 KB, and adds it to the library beside the picture, which is left as
it was. It is for a person who may add to the media library and read it, and
needs the `sharp` image library, now an optional peer dependency of the
plugin.

A page's Twitter card now carries its image's alt text too.
