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

The entry header no longer carries a second copy of the language state. The row
of language pills, the count beside it and the "Languages" actions menu are
gone; the document rail's language panel says all three, and said them already.
The pills and the panel reported the SAME number from the same function — one as
what was done, one as what was left — a few centimetres apart, and the pills
could not be fixed in place: past six languages they overflowed a clipped row,
so a site with fourteen could not reach eight of them at all.

The legend explaining the state dots moved into the panel, where it opens on
request. It was the one thing the actions menu carried that the panel did not,
and without it the dots are decodable only by hovering.

Creating an entry still says which language the first save will be in, since a
document that does not exist yet has no translations to report.
