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

`splitFamilyList` and `isUsableFamilyList` are now published from
`@nextlyhq/blocks-engine`. Reading a family list is quoting, comma and CSS
escape rules together — `"ACME, Inc", serif` is two families, not three — and
`isUsableFamilyList` pairs the quoting rule with the identifier-run grammar that
`FamilyPart.valid` leaves out. Asked alone, `valid` accepts `var(--x)` as a font
called `var(--x)`. `familyToDtcg` now asks the same predicate, so the DTCG
export and the panel cannot disagree about what a browser will read.
