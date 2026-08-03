---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Custom CSS in the page builder can no longer load anything from another origin.
A `url()` carrying a scheme or a host is refused, and the editor says which
declaration went and why, with a pointer to the media library.

This closes a way of reading data off the page. A selector that matches only on
a prefix, paired with a URL that fires a request when it matches, spells a value
out one character at a time — `input[value^="a"] { background: url(...) }`,
repeated. Custom CSS was the only surface where an author controlled both halves;
a block's own style values cannot express a selector, so images set there are
unaffected.

Everything the sanitizer removes is now reported rather than dropped silently,
including at-rules it does not support. A rule that disappears with nothing on
screen to explain it reads as a bug in the builder, and the author's own source
still contains the line that did not survive.

BREAKING, for anyone calling the sanitizer directly: `sanitizeCustomCss` and
`sanitizeBlockCss` return `{ css, warnings }` rather than a string. They are
re-exported from the package root, so this is a visible change even though the
page builder itself is the only expected caller. Read `.css` where you read the
result before.
