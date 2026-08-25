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

Minting a preview link now leaves an audit record, and so does revoking every link.

A preview link is a bearer credential: whoever holds one reads the draft it names,
rendered through the MINTER's field-level permissions. Issuing and destroying those
was invisible - `preview-links.ts` made no audit or activity call at all, so nothing
recorded who opened a draft up, which document, or when the revocation that cut every
reader off happened.

Recorded to the security trail rather than the content one, because that is what this
is. The activity log is content-shaped - its action is create/update/delete and it
requires a collection - so a mint recorded there would surface in the dashboard feed as
though someone had edited the entry. The `audit_log` beside it already carries the
auth events, the actor model, the erasure path a deleted account needs and the retention
window, and this is the same kind of event.

The row names the document, the language, the expiry and the generation, and never the
token: a trail carrying the credential would hand its reader the access it exists to
describe. Written at the one point both the entry and Single mints funnel through, so
neither path can be given a record the other lacks, and only after signing - a refused
mint produces no credential and now leaves no row claiming otherwise.
