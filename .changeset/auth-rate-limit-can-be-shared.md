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

Rate limiting on the login and API-key paths kept its counters in the memory of
whichever process handled the request. On a deployment that runs more than one
instance — which is the normal way to run a Next.js app — every instance kept
its own count, so a limit of five attempts became five per instance, and the
number of instances is decided by the platform rather than by anyone.

The limit that protects sign-in was therefore looser than configured, quietly,
and most so under heavy traffic.

The window can now be kept somewhere both instances can see. Supply a store on
the rate limit config and the login and API-key limits are counted once for the
whole deployment. Change nothing and the behaviour is exactly as before.
