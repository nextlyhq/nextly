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
---

Draft previews no longer need an API key. A preview link now opens a draft session for
exactly one entry: `createPreviewRoute` checks the token, turns on Next's draft mode, and carries
the token onward in an httpOnly cookie so the rest of the request knows which document that session
covers.

The scope has to travel separately because Next's draft mode is a single boolean for the whole
host — turning it on without it would let a link meant for one unpublished page unlock every
unpublished page. `readPreviewScope` re-checks the token on every read rather than trusting that
the route once said yes, so expiry and revocation reach sessions already in flight, and
`previewGrantsDraft` answers the one question a read path should ask.

Every refusal looks the same — a 404 with no cookie and no draft mode — so the endpoint cannot be
used to discover which entries have drafts.
