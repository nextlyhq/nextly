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
`font-src`, `style-src`, `object-src 'none'` and `base-uri 'self'`. Your app
sends the header from its own middleware or `next.config`.

`style-src` carries `'unsafe-inline'`, because the renderer emits its scoped CSS
as inline `<style>` elements and the alternative is a per-request nonce that
would force dynamic rendering. What it still buys you is the part that matters
here: the HOST a stylesheet may be loaded from is bounded, so a block rendering
`<link rel="stylesheet">` cannot pull one from anywhere. `base-uri` is the one
non-fetch directive, because a cross-origin `<base href>` re-points every
relative URL on the page and no fetch directive can express that.

If the response already carries a policy — Nextly's own security headers send
one — union these into it with `mergeCspDirectives` rather than sending a second
header. Policies intersect rather than extend, so an existing `img-src 'self'`
refuses your CDN however many other policies allow it.

Only patterns that translate EXACTLY produce a source: an absent or `https`
protocol, a lowercase domain (literal or with one leading wildcard label), an
absent, empty or non-default port, no `search`, and no path constraint. Anything
else is refused and named by `unexpressibleHosts`.

The awkward cases are where the two grammars read the same word differently. A
CSP `http://` source also matches https — which is why an absent protocol
translates (it means either scheme on both sides) while an explicit `http` one
cannot. A default port is refused because the URL parser removes it before the
matcher compares, so the pattern matches nothing while the source matches the
canonical form. An IP address is refused because CSP host matching ignores any
host that is not a domain, so the source could never match. `**.example.com` is
normalised to `*.example.com`, which accepts the same hostnames on both sides.

A `pathname` is refused outright, which is worth calling out because it looks
translatable and is not. CSP enforces a source's path only on the initial
request, so an allowed URL that redirects elsewhere on the same host still
passes; and it percent-decodes both sides before comparing, so a path also
admits its encoded aliases. Both widen, so a path-scoped pattern gets no source
and is reported instead. The generated policy is therefore never broader than
the one it backstops; where it cannot express a host, you add that source
yourself.

No `script-src` and no `default-src`, which is one decision: a nonce-based
script policy forces dynamic rendering on every page and would defeat ISR, and
`default-src` is the fallback for `script-src`, so emitting one would take that
choice back silently. This is therefore a backstop rather than a complete
policy — `prefetch` and `prerender` fall back to `default-src` and are not
covered by it. Nextly's own security headers already send `default-src 'self'`,
which is the other reason merging into your existing policy is the recommended
path rather than sending this value alone.

`unmergeableStylePolicy(existing)` names a style directive carrying a nonce or
hash. CSP stops honouring `'unsafe-inline'` once one is present, so merging into
such a policy would look successful and still block every inline style the
renderer emits.
