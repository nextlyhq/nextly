---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

The page builder can now generate the Content-Security-Policy fetch directives
for the hosts it is configured to allow.

Custom CSS and block markup can make a request conditional on a secret, and the
parser refuses what it can read. A CSP refuses the REQUEST, which covers the
places a parser cannot reach — a block registered outside the package, and a
cross-origin `<base href>` that re-points every relative URL on the page.

`cspDirectives(remotePatterns)` builds `img-src`, `media-src`, `frame-src` and
`font-src` from the same allowlist the parser uses, so the hosts are declared
once. Your app sends the header from its own middleware or `next.config`.

If the response already carries a policy — Nextly's own security headers send
one — UNION these sources into its directives with `mergeCspDirectives` rather
than sending a second header. Policies intersect rather than extend, so an
existing `img-src 'self'` refuses your CDN however many other policies allow it.

No `script-src`: a nonce-based script policy forces dynamic rendering on every
page and would defeat ISR. Scripts stay your application's business.
