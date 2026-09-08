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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
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
"create-nextly-app": patch
"nextly": patch
---

A widget source can now be answered by a DOMAIN SERVICE rather than compiled to
a collection query, which is what the `system:` source kind has reserved
vocabulary for since it was declared.

Almost everything Nextly knows lives outside the collection tables -- a release
is not a row in one, a translation gap is a relationship between rows -- and
each is governed by a service that already decides who may see it. So a system
source hands the question to that service WITH the caller and adds nothing: no
`where` clause of its own, and no second copy of an authorization rule it
cannot see.

`registerSystemSource` publishes the source and its resolver together, because
a source registered without one is discoverable, validates, and fails only when
a reader puts the card on their dashboard. It accepts only a `system:` source:
the resolver store is keyed by id, and an entry under a collection id would
answer a question the access-controlled Direct API is meant to answer. A system
source nothing answers is refused exactly as a source that does not exist, since
a distinct message would confirm it is real.

`POST /api/dashboard/query` admits these sources, which is what makes the kind
reachable at all. It takes no read decision of its own for one: a system
source's rows are not an entity the permission table names, and the service that
owns them authorizes the same caller, so a check invented at the endpoint would
be a coarser second copy of a rule it cannot see. Collection sources are
unchanged, and every other kind is still refused.
