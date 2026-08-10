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

`PageRenderer` takes a new `hostPolicy` prop, forwarded to every block through the render context. It carries decisions that belong to the developer standing up the site rather than to whoever fills in a page: a block's props are content, and content is untrusted input, so a security posture modelled as a prop is one an editor answers.

`core/embed`'s `allowSameOrigin` was exactly that — a checkbox any page editor could tick against any URL, granting a frame the one permission that lets it remove its own sandbox. It is replaced by `hostPolicy.trustedFrameOrigins`, an allowlist compared as full origins through the URL parser: scheme, host and port together. A different scheme, a different port, a subdomain, and a suffix lookalike such as `player.example.com.evil.test` are all refused, as is a relative URL, which resolves to the host's own origin and is the one grant that would let a frame reach the page around it.

Documents that still carry `allowSameOrigin` are unaffected in the safe direction: the value is ignored and the frame stays sandboxed. An unparseable entry in the allowlist is skipped rather than throwing, so a typo in configuration cannot take down every page holding an embed.

Every policy field is optional and every default is the closed one, so a host that configures nothing keeps the restrictive behaviour.
