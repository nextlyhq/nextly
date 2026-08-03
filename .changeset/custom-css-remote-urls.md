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
repeated. Custom CSS is the only surface where an author writes both halves, so
that is where the ban lands; a block's own style values still accept a remote
image, because they cannot express a selector.

The narrower thing this does not do, stated plainly rather than left implied:
custom CSS can still modulate a request another part of the page already makes.
A block background may be remote, and a custom selector that suppresses it
conditionally leaks by the request's absence while containing no URL to refuse.
Closing that needs the same origin policy applied to structured style values, or
a Content-Security-Policy on the rendered document.

Everything the sanitizer removes is now reported rather than dropped silently,
including at-rules it does not support. A rule that disappears with nothing on
screen to explain it reads as a bug in the builder, and the author's own source
still contains the line that did not survive.

CSS the sanitizer cannot read through — a rule nested deeper than it follows, or
a fragment it cannot parse — is still removed, but it is now reported as
unchecked rather than as a remote URL. It previously named the whole rule as the
offending address, which sent authors looking for a host their stylesheet never
mentioned. The depth it follows also rose well past real CSS: the old limit
refused valid stylesheets at five levels of nesting, which ordinary compiled CSS
reaches.

BREAKING, for anyone calling the sanitizer directly: `sanitizeCustomCss` and
`sanitizeBlockCss` return `{ css, warnings }` rather than a string. They are
re-exported from the package root, so this is a visible change even though the
page builder itself is the only expected caller. Read `.css` where you read the
result before.

Also on that surface: `CssWarning["code"]` gains `"unchecked"`, which a switch
over the union has to handle, and CSS that fails to parse outright now reports
`"unchecked"` where it reported `"unsafe-value"`. `MAX_RULE_NESTING` and
`MAX_VALUE_NESTING` are exported alongside them.
