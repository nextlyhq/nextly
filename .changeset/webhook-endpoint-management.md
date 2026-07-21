---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Webhook endpoints can now be registered, changed, disabled and removed.

The delivery engine, fan-out and signing were all built before anything could create an endpoint for them to act on — the only rows that ever reached the table were test fixtures. This adds the management layer they were waiting for: an endpoint carries a name, a target URL, the event types it subscribes to, and optional static headers, and it receives its own signing secret at creation.

A URL is resolved and checked before it is stored, not only before it is called. Delivery already refuses private, loopback and cloud-metadata addresses, but that happens long after whoever typed the URL has moved on, so a mistake shows up as a silent, repeating delivery failure. Checking at registration turns it into an error that can still be corrected.

Disabling an endpoint is kept separate from deleting it. Only one of those is reversible, and an endpoint id tends to end up in someone else's configuration.

Disabling now also stops deliveries that were already queued. Previously it only removed the endpoint from future fan-out, so a retry scheduled by an earlier failure, or an event that fanned out moments before, would keep being POSTed until it succeeded or ran out of attempts. Those deliveries are now ended rather than held, so re-enabling an endpoint does not release a burst of events its receiver has long since stopped expecting.

Static headers are checked when they are saved. A header name that is not a valid HTTP token, or a value containing a line break, can never be sent: the delivery path could not tell that apart from a network fault, so it treated it as temporary and retried an endpoint that could never succeed.
