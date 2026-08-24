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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Preview links work. The whole draft-preview stack shipped built and exported but never
connected to anything: no application mounted `createPreviewRoute`, no content route consulted a
preview token, and the copy-link button in the entry editor handed out a URL that answered 404.

Mounting it is now one line, because `createPreviewRoute()` and `previewDraftGate()` take no
required arguments. The signing secret, the revocation generation, Next's draft mode and the
request's cookies are all facts about the booted instance rather than decisions a site makes, so
they default — and a route file that costs a paragraph of wiring is a route file nobody writes:

```ts
// src/app/api/preview/route.ts
import { createPreviewRoute } from "nextly/runtime";

export const { GET } = createPreviewRoute();
```

Where a link lands is derived from the collection's own preview declaration — the `url` function a
code-first collection carries, or the `urlTemplate` a UI-created one does — so nothing has to be
restated. A site that routes its content some other way still supplies its own `redirectTo`.

This no longer requires a configured site URL. The admin needs an absolute URL because it may be
served from another origin; the preview route does not, because it is already running on the site,
so a relative path resolves against the origin the visitor is standing on. Where there is no origin
to compare against, the path's shape is checked instead, so a protocol-relative value cannot pass
itself off as a local path.

Add `draft: previewDraftGate()` to the content route the link lands on. Without it the route serves
published entries only, and a preview link verifies, redirects, and then answers 404 from a page
that looks entirely correct.

A collection that declares no preview URL now refuses to mint a link, instead of reporting success
and handing over one that answers 404. Nextly cannot work out where an entry is served — only the
application knows whether a post with the slug `hello-world` is at `/hello-world` or
`/blog/hello-world` — so a collection says it:

```ts
admin: {
  preview: {
    url: entry => (entry.slug ? `/blog/${entry.slug}` : null),
  },
},
```

The "Copy shareable link" button still appears either way, deliberately: hiding it would leave an
editor with a feature that vanished and nothing explaining why. Refusing at the click puts the
cause, and the fact that a developer is the one who fixes it, in front of the person who hit it.

The page builder's own `pages` collection declares one when — and only when — the host says where
those pages are served: `pageBuilder({ pagePreviewPath: "/{slug}" })` for pages at the site root,
`"/blocks/{slug}"` for a site that mounts them under a prefix. There is deliberately no default.
The plugin cannot install your preview route or your draft gate and cannot discover where you
mounted your pages, so a defaulted path would let an editor mint a link that resolves to nothing —
strictly worse than the refusal, which names what a developer needs to add. Passing the option is
how an app states that it has done the wiring.

In development, a content route that receives a valid preview link while declaring no
`draft` hook now says so, naming the hook to add. Production is unchanged: every refusal stays an
identical 404, because one that varied by cause would let a stranger discover which entries have
drafts.

The preview mount is validated when configuration is read, rather than when an editor clicks "Copy
shareable link". `preview.route` names where your app mounts `createPreviewRoute`, and a value that
cannot produce a working link — one pointing at another origin, or carrying a query, a fragment or a
`..` segment — stops the boot with a message naming the value and the remedy. Previously the first
sign of a bad mount was an editor being refused a link, and the person who can fix it is not the
person reading that message.

It is resolved after plugin `setup` transformers run, so a mount a plugin adds or replaces is
checked as the one a link is actually built from, and the normalised value is what the container
carries: `"/api/preview/"` no longer means one thing where it is read and another where it is used.

A mount carrying its own query is refused rather than accepted and mangled. The link's `token`
parameter is appended to this path, so `"/api/preview?tenant=a"` was assigned as a pathname and
handed out as `/api/preview%3Ftenant=a` — a link that reaches no route and carries no token. A `..`
is refused for a related reason: it resolves against whatever base the link is built on, and a site
URL carrying its own path is a different base from the origin, so the mount would not be the one the
value names.

New guide: **Draft Preview Links**.
