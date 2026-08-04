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

The page builder can now generate Content-Security-Policy fetch directives for
the hosts it is configured to allow, as a backstop to the origin policy already
enforced when compiling styles and markup.

`cspDirectives(remotePatterns)` builds `img-src`, `media-src`, `frame-src`,
`font-src` and `object-src 'none'`. Your app sends the header from its own
middleware or `next.config`.

If the response already carries a policy — Nextly's own security headers send
one — union these into it with `mergeCspDirectives` rather than sending a second
header. Policies intersect rather than extend, so an existing `img-src 'self'`
refuses your CDN however many other policies allow it.

Only patterns that translate EXACTLY produce a source: `https`, a lowercase
literal or single-wildcard hostname, an absent or empty port, no `search`, and a
path that is absent, literal, or a `/prefix/**` glob. Anything else is refused
and named by `unexpressibleHosts`, because CSP and `remotePatterns` read several
of the same words differently — a CSP `http://` source also matches https, an
omitted port means "the default port" rather than "any port", CSP compares hosts
case-insensitively while the matcher does not, and CSP never matches a query at
all. The generated policy is therefore never broader than the one it backstops;
where it cannot express a host, you add that source yourself.

No `script-src`: a nonce-based script policy forces dynamic rendering on every
page and would defeat ISR. Scripts stay your application's business.
