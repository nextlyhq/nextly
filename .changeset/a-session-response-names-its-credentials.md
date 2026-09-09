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

A session-gated response names every credential it depends on, and keeps a quoted cache directive whole.

**`Vary` names the API key as well as the cookie.** A non-public plugin route accepts `Authorization: Bearer` — `requireAuthentication` resolves an API key to its own user, roles and permissions — so two different keys had the same cache key while their responses legitimately differ. For any intermediary that stores despite `no-store`, which is the fallback this header exists for, the first key's answer could be replayed to the second. Both credentials are named now.

**A quoted `Cache-Control` directive is no longer split down the middle.** `private="Set-Cookie, X-User"` is one field-qualified directive, and splitting on every comma made it two: the first was discarded as `private` and the second survived as the fragment `X-User"`. Measured on that input, the emitted header was `private, no-store, X-User"` — malformed, with an unbalanced quote, which a strict intermediary may reject along with the privacy directives it was carrying. Members are now separated only on commas outside quoted strings, with backslash escapes honoured, so a quote written inside a value does not end it.
