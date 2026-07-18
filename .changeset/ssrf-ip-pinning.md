---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
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
"@nextlyhq/ui": patch
---

Pin the validated IP when `safeFetch` connects, closing DNS rebinding.

`safeFetch` previously validated a URL's resolved addresses and then handed the raw URL to `fetch`, which resolved DNS a second time at connect. An attacker controlling DNS could answer with a public IP during validation and a private one at connect, reaching internal services. It now issues the request over `node:http`/`node:https` with a `lookup` that forces the socket to the exact address validation vetted, so no second resolution can occur. It also stops following redirects (a 3xx is returned as-is), caps the response body, and bounds the whole request (including DNS validation) with a deadline. A new `SafeFetchError` distinguishes an over-large or timed-out fetch from an SSRF rejection. The URL validator now also rejects IPv4-mapped IPv6 literals in their hex-normalized form (for example `[::ffff:127.0.0.1]`, which `URL` rewrites to `::ffff:7f00:1`), closing a loopback/private bypass.
