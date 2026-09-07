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

A wholly malformed document is refused before the site's settings are read.

Moving the breakpoint scan ahead of the readability gate put it ahead of the
malformed-root refusal too, so a `null`, a primitive or an array — a value that
was never going to be validated — still caused the caller's breakpoint settings
to be read, and an adversarial set escaped as a native error.

The coarse root test runs no user code: `typeof`, a null comparison and
`Array.isArray` invoke no trap, where asking for a prototype is something a
hostile root can refuse. So the coarse question is settled first and the precise
one stays where it was, after the survey has had its say.

`Array.isArray` can still throw even though it runs nothing — a revoked proxy
refuses the array brand rather than answering it — so it is wrapped, and a root
that cannot answer reaches the survey's readability verdict instead of being
refused on a question nothing answered.

Both readings now live beside each other as `isPlainRecord` and
`definitelyNotARecord`, sharing the clause they agree on and reporting one
issue. The throw-free reading refuses only what the full one would refuse, so
asking it early can never disagree with asking the full one late — a property
asserted over a shared table of root shapes rather than left as a convention.
