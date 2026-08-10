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

Let a site operator, rather than a page editor, decide which embeds may keep their own origin.

`PageRenderer` takes a new `hostPolicy` prop, handed to every block as a separate render argument — `BlockRenderArgs.hostPolicy`, not a field on `PageContext`, which carries no such value. It holds decisions belonging to the developer standing up the site rather than to whoever fills in a page: a block's props are content, and content is untrusted input, so a security posture modelled as a prop is one an editor answers.

`core/embed`'s `allowSameOrigin` was exactly that — a checkbox any page editor could tick against any URL, granting a frame the one permission that lets it remove its own sandbox. It is replaced by `hostPolicy.trustedFrameOrigins`, an allowlist compared as full origins through the URL parser: scheme, host and port together. A different scheme, a different port, a subdomain, and a suffix lookalike such as `player.example.com.evil.test` are all refused, as is a relative URL, which resolves to the host's own origin and is the one grant that would let a frame reach the page around it.

The comparison requires an explicit authority, so `https:player.example.com` is refused as well: a URL parser reads that as an absolute URL while a browser resolves it against the document, which would have granted same-origin to a frame loading the host's own origin. The grant does not, and cannot, survive scrutiny of a later navigation: sandbox permissions belong to the frame rather than to one request, so an allowlisted origin is trusted for anything it redirects to, and a site that needs that bounded should pair the allowlist with a `frame-src` content security policy.

The policy reaches a block as a render ARGUMENT rather than as a field on the context, and the host's own context object is passed through untouched. Deriving a modified copy of it cannot be done faithfully: a spread drops the prototype methods of a context implemented as a class, and even a prototype-preserving clone fails a method that reads a native private field, because the clone is not branded with it. Threading the value instead also settles who may set it, since a block builds the context it hands `renderSlot` — as an argument the boundary supplies, a nested block can neither lose the grant nor award itself one.

Documents that still carry `allowSameOrigin` are unaffected in the safe direction: the value is ignored and the frame stays sandboxed. An unparseable entry in the allowlist is skipped rather than throwing, so a typo in configuration cannot take down every page holding an embed.

Every policy field is optional and every default is the closed one, so a host that configures nothing keeps the restrictive behaviour.
