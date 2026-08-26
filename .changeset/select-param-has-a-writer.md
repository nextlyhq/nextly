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
---

The `select` query parameter has a writer, and a request it cannot read is refused rather than answered with every field.

`select` accepts a JSON object naming the fields you want — `{"title":true}` — and nothing else. That was never written down anywhere a caller could find, and only the reader existed, so every caller worked the format out for itself. The API Playground rediscovered it by probing a running server and recorded the answer in a comment; the form builder guessed a comma list and shipped it, downloading every field of up to fifty documents per collection to fill a dropdown that reads five.

Neither caller was told. Anything the reader could not understand — a comma list, a bare field name, an array, an empty object — returned the whole document, which is exactly what a request asking for the whole document returns. `{"title":false}` was worse: it counted as a projection, then selected no field, and a projection selecting nothing is answered with every field. An author writing it to mean "everything except the title" got the opposite.

`nextly/query` now exports `encodeSelectParam` and `readSelectParam`, so a caller writes the parameter with the same code the server reads it with, and the reader distinguishes "no projection was asked for" from "I could not read your projection". The second is a 400 naming the format, instead of a correct-looking response carrying every row in full.

It is a leaf entry point rather than a root export: the admin's API Playground and plugin admin components import it from the browser, and the root entry would bring the server graph with it.
