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

A preview link no longer shows its recipient fields the person who shared it cannot see.

A granted draft read is trusted — that is what lets the working draft appear at all, since the
overlay is gated on edit capability while a preview route resolves anonymously. But ONE flag
decides both row trust and FIELD trust, so trusting the row switched field-level read rules off
along with it and the page rendered every field. An editor denied a field could therefore read it
by sharing a link and opening it themselves.

The row is still read trusted; the FIELDS are now judged against the person who shared the link.
The token records who that was — as a redaction basis, not as an identity: the bearer is still
anonymous and still reaches exactly the one document the link names. What it decides is which
fields of that document appear, so a link shows what its sender sees and no more.

Links minted before this shipped carry no such record and render as they always did. They expire
within hours, and revoking every outstanding link to close a gap that closes itself was the worse
trade.

A rule that reads a profile field other than the sharer's id or roles sees it absent and therefore
denies, so it withholds MORE rather than less — the safe direction, and worth knowing if a field is
gated on something like an email domain.
