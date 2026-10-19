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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

Core's own rate limits now count in the limit store the site selected with
`rateLimit.store`: the sign-in limit, the limits plugin routes ask for, the REST
API limit and each API key's limit. On `"database"`, every instance of the site
counts one budget, where each used to count its own.

- **Keys are stored only as keyed hashes in the selected store.** Client
  addresses, account ids and API key ids no longer reach the memory store, the
  database store or an app's `LimitStore` as given. An app's store of the
  earlier `RateLimitStore` contract still receives them as before.
- **Counts roll in 32 buckets per window.** An attempt counts for one window
  from when it was made, and can be forgotten up to 1/32 of the window early.
  The sign-in limit used to slide exactly, and the REST limit reset its whole
  window at once.
- **An app's store of the earlier `RateLimitStore` contract keeps serving
  core's own limits**, as before.

**A store outage after a good start now refuses core's sign-in requests**
(`503`, "Please try again shortly."), on core's `/auth/*` endpoints and on plugin
routes with `rateLimit: "auth"`, while the REST API, API key and other plugin
route limits let requests through. A store call that takes more than 2 seconds
counts as an outage. Each outage is logged once when it begins and once when
the store answers again. Before, a store failure failed the request. With an
app's own store, an outage stops staff sign-in until the store answers, so
monitor that store.

**Existing installs see one new production warning**, until they select the
database store (`rateLimit.store: "database"`) or say they run one instance
(`rateLimit.singleInstance: true`). With only a store of the earlier contract,
the warning says that plugin limits count in memory.

The memory store holds at most 100,000 live entries (`rateLimit.maxEntries`).
When it is full and nothing has expired, a new key is answered as
unavailable, so a sign-in from a new address is refused and an API request is
let through.
