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

`GET /api/jobs` reports what the background queue recently did.

A background job that fails is invisible. There is no request to inspect, no
status code and no page that went blank — so a scheduled release that did not
publish looked exactly like one that was not due yet. The outcome, the attempt
count and the error were all recorded on the row and readable only with SQL.

Each row carries a DERIVED status beside its stored state, because the stored
vocabulary cannot express the distinction that matters most. A job whose attempt
failed and which will try again is written back as `pending`, indistinguishable
by state from one that has never run — while `failed` is terminal and means the
work will not happen without a person. `jobDisplayStatus` separates them from
the attempt count, in one place, so a client cannot derive a second answer.

Read-only on purpose: no retry, no cancel, no requeue. Each is a write on
already-authorized work and needs its own decision about who may perform it,
and shipping them beside a read would settle those questions by omission.

Gated on `manage-background-jobs`, the permission the trigger already uses.
`lastError` carries whatever a handler threw, which is internal detail rather
than content, and there is no seeded read permission to widen to — inventing one
would change what preset roles grant as a side effect of adding an endpoint.

Terminal rows are pruned on the retention window, seven days by default, so this
is recent history by construction rather than an archive.
