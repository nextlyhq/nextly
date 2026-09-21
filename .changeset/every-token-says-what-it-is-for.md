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
"@nextlyhq/plugin-mcp": patch
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

Any HS256 token signed with `NEXTLY_SECRET` that carried a `sub` was accepted
as a session. The session verifier refused only the one token kind it had been
told about, and the account-state endpoint did not check even that, so a token
minted for a different job — a mid-challenge pending token, or anything a
future flow signs with the same secret — could be presented as a sign-in.

Every token now carries a JWS `typ` header naming what it is for, and a token
is verified for one purpose: a header naming another purpose is refused. The
signing algorithm is pinned explicitly at the same time, so a token declaring
`alg: "none"` cannot talk the verifier out of checking the signature.

This release still accepts a session token with no `typ` header, so tokens
already in circulation keep working; a later release will require it, which
will stop Direct API tokens minted before this change. Browser sessions are
unaffected either way, because access tokens rotate every fifteen minutes.

A custom user field named `typ` can no longer reach the claims, where it would
have been read as a token kind.
