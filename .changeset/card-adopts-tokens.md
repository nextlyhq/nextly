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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

feat(blocks-react): core/card adopts the surface and border tokens

`core/card` declined a background and a border for as long as no design token
resolved. Both `color.surface` and `color.border` are now in the guaranteed set
and both render paths emit the sheet that defines them, so the block carries
them — as `{ $token }` references rather than literals, because a literal colour
is wrong in whichever of light and dark it was not chosen for, which is the whole
reason a token set exists. The border is written per LOGICAL side, so a
right-to-left page borders the side an author means.

This also DELETES the ratchet that forbade `{ $token }` in `baseStyles`, which is
the swap it was written for: its stated expiry was "when the site stylesheet is
wired into the render path", and both paths now emit it. It is replaced by the
question that matters now — a default may only name a token the guaranteed set
DEFINES, because a reference to an undefined name dangles for exactly the reason
the old defect did, and neither the catalog check nor the compiled-CSS check can
see it.
