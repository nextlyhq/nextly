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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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
"create-nextly-app": patch
"nextly": patch
---

The SEO plugin's `notFoundLogged()` no longer turns a kept 404 into a 200. With Cache Components on, Next.js keeps the 404 of a route whose answer it caches (a public content route such as `createPublicBlocksPage`, or a page with `generateStaticParams`) and answers later requests for that address with status 404, but `notFoundLogged()` read the request first, so every request rendered the miss again and was answered with status 200 and a `noindex` tag. It now answers not found at once and reads the request only where Next.js renders the miss for one, so the 404 is kept. The address is counted when its 404 is made, on its first request and again once the kept answer expires, and requests served the kept 404 are not counted. A route that renders each request, such as one with a draft gate, is counted for each request as before. A root catch-all (`app/[...missing]`) that never reads its address is now made once at build and keeps that 404 for every address, so it counts nothing: read the address inside `<Suspense>` and list one in `generateStaticParams`, as the SEO plugin guide shows.
