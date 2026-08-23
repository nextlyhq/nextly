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
