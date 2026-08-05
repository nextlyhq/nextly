---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/eslint-config": patch
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
"create-nextly-app": patch
"nextly": patch
---

Custom CSS and site tokens read a few more names the way a browser does.

A name written with CSS escapes is now recognised wherever one can appear: a
custom property spelled `\2d\2d anim`, a unit spelled `1m\73`, an `rgb()`
whose function name carries an escape. Each of these is ordinary CSS that
renders, and each was previously read as something else or not read at all.

Names are also followed into two places they were not. A reference written only
in a `var()` fallback — the branch that runs exactly when the variable is not
set — now follows the rename, and so does the `-webkit-` prefixed animation
shorthand.

Inside a `font` shorthand each fallback is read against the slot its `var()`
occupies rather than one verdict for the whole declaration. A fallback in the
line-height slot is no longer mistaken for a family, and a family fallback that
follows an earlier function is no longer skipped.

Several spellings that CSS discards are no longer treated as usable. A bare
`default` is the keyword rather than an animation name; a `@font-face` family
descriptor written as a bare CSS-wide keyword is ignored, as the browser
ignores it; and a `src` entry needs a real argument, so `local()` with nothing
in it no longer counts as a font this site can load.

Design-token export refuses two more things it cannot honestly represent: a
family list holding a bare CSS-wide keyword, or an item that is not an
identifier run, since neither names a font. Import refuses a colour whose `hex`
contradicts its own components rather than silently preferring one.
