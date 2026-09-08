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

A scaffolded app builds its absolute URLs from the origin it is actually served
on. The templates hardcoded `http://localhost:3000` in five places, so anyone
running on another port — or running when 3000 is taken, which moves Next to a
different port on its own — got pages that render while every canonical link,
Open Graph tag, sitemap entry and RSS URL points at nothing. The port is not
knowable when the project is generated and is knowable at runtime, so the
derivation moved into the app.

The base template also documented `NEXT_PUBLIC_APP_URL` while its layout read
`NEXT_PUBLIC_SITE_URL`, so setting the only URL variable a new project was given
changed nothing a reader would ever see. Both are now documented with what each
one is for — the app's own origin, which the backend uses for emails and preview
links, and the public site's origin, used for metadata — and the public one
falls back to the app's rather than to localhost.

The five copies of that expression are now one module, `src/lib/site-url.ts`,
which every template inherits.
