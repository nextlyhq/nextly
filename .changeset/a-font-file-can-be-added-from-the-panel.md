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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

An author can add a font file to a site from the fonts panel. Choosing a
`.woff2` or `.woff` stores it through the media pipeline and declares the
`@font-face` that loads it, pointing at this site's own byte route — the only
kind of source the engine accepts, since a face fetched from another server
hands that server every visitor's IP address before the page can be read.

The weight and style are asked for rather than guessed from the filename. A
face declaring the wrong weight loads, matches nothing the author meant, and
the page renders in the fallback with no error anywhere; the family alone is
prefilled from the filename, where a wrong guess is visible in a field before
it is stored.

The faces a site loads are now grouped by family, each cut named. Adding a
typeface means adding its regular, its bold and its italic, and a flat list
repeated the name while saying nothing about which weights the family covers.

`useUploadMedia` is available to plugin admin components through
`@nextlyhq/plugin-sdk/admin`. It is the one route a plugin has to put bytes on
the site, which anything referencing a file — a `@font-face` above all — needs
before it can point at one.

The panel's controls are not a form of their own. They are rendered inside the
entry editor's, and a nested form's submit reaches the editor's handler — so
pressing Enter in one of these fields started the upload AND saved the page
entry, committing the document as it stood before the builder opened. Enter now
adds the font and nothing else.

An add is refused when the stored style holds a font row this version cannot
read, naming the row. The section is saved by replacement, so appending to what
was read would have saved a list that row is missing from — and the save would
have succeeded, because the list sent is exactly the one the checker approves.

Web font formats carry the `format()` keyword their `src` entries take, so the
panel, the upload gate and the public byte route read one table instead of
three; a descending weight range such as `900 100` is refused, since a browser
drops the whole descriptor and matches the face at a weight nobody chose.
