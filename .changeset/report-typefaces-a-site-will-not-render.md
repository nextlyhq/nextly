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

Add the fonts panel, which reports which typefaces a site will actually render.

`compileSiteSheet` emits `@font-face` blocks and token custom properties
independently, so a `fontFamily` token naming a family the site loads no face
for is emitted exactly like one that has it. The page then draws in whatever
the browser reaches for next, nothing errors, and nothing is logged — the same
silent substitution the sheet's own `tokenPrefix` note describes one property
along.

The panel joins the two lists, which is the only way to see it: the tokens
studio edits one token and knows nothing about faces, and the inspector knows
nothing about either. It authors nothing itself, so creating and renaming
typeface tokens stays the studio's single job.

Every family is drawn in itself. A list of typeface names set in the interface's
own font asks an author to choose a typeface from its name, and a family the
site does not provide renders in the fallback — so the substitution is visible
rather than described.

Nothing is called missing or unavailable. A named family with no face may be
installed on the reader's device, so the wording says what is true: this site
provides no font file for it.

`readFamilyList`, `familyPartKind` and `splitFamilyList` are now published from
`@nextlyhq/blocks-engine`, and they classify rather than answering yes or no.
CSS reads a family list four ways and a boolean misdescribes two of them: a
stack holding `var(--font-geist)` is read perfectly and cannot be resolved from
the text, and a lone `inherit` is valid while naming no family at all. Each item
is classified as a name, a generic keyword, a `var()` substitution, a CSS-wide
keyword, or invalid; the list's own reading follows from those.

`familyToDtcg` asks the same reading and applies its own narrower rule to the
answer, so the DTCG export and any surface reporting on a site cannot disagree
about what a browser will read.

`splitFamilyList` no longer discards empty items — it keeps them, marked
invalid. `font-family: Brand,` is a parse error the browser drops the whole
declaration for, and reporting it as the single family `Brand` described a value
the page never rendered.
