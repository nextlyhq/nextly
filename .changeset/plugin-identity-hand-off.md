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

Core takes the hand-off when a listed login plugin finishes a sign-in at an outside provider. The provider key is stamped with the plugin's own name, so one plugin can neither read nor claim a row in another plugin's namespace; the subject, the address-proof flag and the plugin's statement that the identity passed its provider's admission restriction are parsed strictly at the door and refused when malformed, negative or absent, before the table is read, whether the identity is linked yet or not. The stamped key passes the linking policy's enabled gate before any lookup, the issuer is part of the lookup key, and the hand-off resolves the identity to its linked account without writing anything — an unlinked identity resolves no account, and whoever is signed in at the time is left alone. An explicit link completes through an operation of its own, never as a sign-in: only for the user who started it, still signed in on the session they started it in, attaching the identity without matching addresses and issuing no session, and refusing an identity another account already holds rather than moving it.
