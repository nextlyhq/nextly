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

**One table now decides what an HTTP status means when a failure names no error code.**

Three tables used to, and they disagreed. The same code-less 401 reached a Direct API caller as
`AUTH_REQUIRED` and a REST caller as `INTERNAL_ERROR`; a code-less 429 lost its rate-limit
identity entirely, and with it the `Retry-After` a client needs to back off correctly. The media
service kept a third table that read 409 as `DUPLICATE` and 422 as `BUSINESS_RULE_VIOLATION`.

A code-less failure now resolves through one shared table for 400, 401, 403, 404, 409, 413, 415,
422, 429, 502 and 503, and anything unrecognised stays an internal error. The producer's own
status is preserved rather than rounded to the code's canonical one.

**The table is a fallback, not a translation.** A status is coarser than a code: 409 covers both
"that name is taken" and "someone else edited this", which need opposite advice. A service that
knows which one it means sets `code` and is believed. `MediaResponse`, `DeleteMediaResponse`,
`FolderContentsResponse` and the folder bulk-delete result can carry a code for exactly this
reason, and creating a folder whose name is taken now says so through `DUPLICATE` rather than
relying on a boundary to guess.

**A code-less failure never puts its own message on the wire.** Those envelopes come from legacy
converters that may store a raw exception's text, so the caller gets the generic sentence for the
derived code and the detail stays in the operator log. A failure that names a code keeps its own
message, which the producer authored to be read.

Behaviour changes worth checking if you read error bodies directly: a code-less 401 answers
`AUTH_REQUIRED` instead of `INTERNAL_ERROR`; a code-less 429 answers `RATE_LIMITED`; a code-less
422 answers `INVALID_INPUT`; and through the Direct API a code-less failure's message is now the
generic sentence rather than the service's raw text.
