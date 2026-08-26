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

The in-admin preview pane now works when the admin and the site share a host
but differ by PORT — a contributor running the admin on `:3000` against a site
on `:3100` gets the pane instead of being sent to a new tab.

Whether a preview can be shown in a frame is now answered by the server, in the
mint response, rather than by the browser comparing two URLs. The question is
whether the preview COOKIE survives being framed, and only the server can see
both halves of that: the site's address, and the `SameSite` attribute the cookie
is actually set with. The browser was answering a question it could not see the
inputs to — correct only while nobody changed the cookie, and wrong silently
afterwards, because the failure mode is a frame that renders the PUBLISHED page
under a draft caption.

Being stricter than the truth was the visible half of that. The old test
compared origins, and origins include the port while same-site does not, so the
dev split above was refused for a reason browsers do not apply.

The mint response carries `embeddable` beside `url` and `expiresAt`. It states
that the SESSION reaches a frame, not that the frame will load: an application's
own `frame-ancestors` is invisible from the server, and a caller must not read
it as a promise that the embed succeeds.

Where the server still declines, nothing changes — the pane says so and offers
the new tab that works everywhere. That fallback is not a stopgap: browsers that
block third-party cookies prevent an embedded cross-site preview regardless of
the cookie's attributes, so every CMS that embeds one keeps a first-party
fallback beside it.

One limit is deliberate and recorded in the code. `admin.example.com` and
`example.com` ARE same-site and would be safe to frame, and the server still
refuses them, because separating that shape from `foo.github.io` and
`bar.github.io` needs a public-suffix list this repository does not carry. The
refusal is the affordable error: a wrong `false` costs a tab, a wrong `true`
shows the published page and says it is a draft.
