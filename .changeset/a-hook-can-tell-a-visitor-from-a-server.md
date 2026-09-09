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

A hook could not tell whether the write it was running on came from a browser
or from a seed script, so a rule that only makes sense for a visitor, a rate
limit or a honeypot, could not be written at the write seam at all. It had to
live in one route, and a collection that grants public create has more than one
door into it.

Collection operations now accept the HTTP request that produced them, and the
core resolves it into the facts hooks read as `ctx.req`: the headers, and a
client address judged against this deployment's `security.trustProxy` and
`TRUSTED_PROXY_IPS` rather than read raw off `x-forwarded-for`, which is
whatever the sender chose to claim. `ctx.req.http` is absent when no request
produced the write, and that absence is what tells a request-scoped rule to
stand down instead of judging a server-side import as a visitor.

Both HTTP doors pass it down, and `ctx.services.collections` takes it too, so a
plugin serving its own route can hand over the request it was given. The form
route's audit column now records the resolved address instead of the leftmost
forwarded hop.
