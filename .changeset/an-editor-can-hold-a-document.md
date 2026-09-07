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

An editor can now hold an advisory claim on the document they are editing,
and be told when a colleague is already in it.

`useDocumentLock` claims on mount, renews on a heartbeat and releases on the
way out. Renewing stops the moment a claim is taken over, and reports WHO took
it, because the acquire outcome carries the new holder. A failed renew is not
a lost claim: the lease outlives several beats, so a dropped packet resolves
itself on the next one, and treating it as a takeover would move an editor to
read-only over a blip.

The timings come from `nextly/document-lock`, a client entry carrying the lease
contract and the wire types and nothing else. They are the agreement between a
lease and whoever renews it, and a second copy of either number drifts from the
first the moment one is tuned. It is its own entry rather than part of the root
one because the admin maps `nextly` to this package's source: reaching two
constants through the root pulls the DI container and the auth middleware into
the admin's typecheck, measured at 112 errors about code it never touches. The
repository stays behind the route, where it belongs.
