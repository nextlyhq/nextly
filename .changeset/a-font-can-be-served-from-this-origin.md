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

A self-hosted font could be uploaded nowhere and served from nowhere. The
upload allowlist carried no font type, so a `.woff2` was refused before it was
stored; and a `@font-face` may not name another host, so a font that did reach
S3, Vercel Blob or UploadThing was unusable at the only address it had.

`font/woff2` and `font/woff` are now accepted — and only those two, because
nothing here converts TTF or OTF, which would be stored and sent to every
visitor at several times the size of the same face with nothing reporting it.

Stored bytes can now be served from the site's own origin at
`/api/media/:id/raw`, which the existing media handlers mount. It answers
without a session, because the browser fetching a font does not have one, and
what keeps that safe is the type: it serves the publicly servable formats and
answers 404 — never 403 — for everything else, so it cannot be used to read a
private file or to ask whether one exists.

Reading a stored object also stopped being two implementations. The attachment
path and the new route ask one function, which tries the adapter's own `read`
and falls back to a bounded fetch of its public URL, refusing over-cap bytes in
the same words either way. An over-sized error page is no longer reported as an
over-sized file.
