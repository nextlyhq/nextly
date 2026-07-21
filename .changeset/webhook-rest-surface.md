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

Webhook endpoints can now be managed over the REST API.

The management service landed without anything able to reach it. This adds the
six routes that expose it: list and register endpoints, read, update and delete
one, and read back its active signing secrets.

Registering or changing an endpoint requires an interactive session and cannot
be done with an API key. An endpoint names a URL the server will call and send
content to, so it is both a request-forgery and an exfiltration primitive; that
is not something an API key should be able to set up on its holder's behalf.

Reading a signing secret asks for the update permission rather than read. The
secret is what proves a request came from this install, so a read-only role that
could see it could forge traffic every receiver would trust.

Disabling an endpoint is an ordinary field update rather than its own route,
because disabling already ends the deliveries queued for it wherever it is done.

Deliveries still need a trigger. Nothing runs the drain yet, so a registered
endpoint will not receive anything until that lands.
