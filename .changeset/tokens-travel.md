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

Bring a design-token file into the tokens studio, and take one out. An import
merges: tokens the file names are added or updated, matched on the identity a
reference stores, and anything the file does not mention is left alone — so an
import can never delete a token that blocks across the site still use. A file
usually holds entries this site has no kind for, since the format defines more
types than the engine maps, so what fits comes in and everything skipped is
named with the reason. Export writes the token document a design tool reads back
exactly, and the CSS custom properties a visitor's stylesheet actually contains,
compiled by the same function that builds the site sheet.

Fixes a token named `constructor`, or any path passing through that segment,
being refused on export as though the site already held it: the emitter read
the name off the document object directly, where `Object.prototype` answers for
it. Such a token now leaves and returns unchanged.

A file can describe one token twice — the format's own `$value`, and the exact
CSS this system wrote beside it. The stored CSS is still what gets imported,
since it holds what the author typed, but when the two genuinely disagree the
import now says so instead of discarding the file's value in silence. Only a
real difference in the colour is reported, never a difference in how it is
spelled, so a file exported from here never carries the warning.

Also: a field this system does not read inside its own extension is now named
rather than dropped in silence, and a document nested past the group limit is
refused with one message instead of a second account of every entry inside the
branch the engine had already rejected whole.
