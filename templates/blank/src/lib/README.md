# Lib

Project-wide helpers and utilities. Add files here for things that get
imported across multiple components or routes.

Examples (from the blog template, for inspiration):

- `format-date.ts` — locale-aware date formatting.
- `site-url.ts` — resolves canonical URLs for OG / sitemap.
- `queries/` — cached Direct-API wrappers (e.g. `getPostBySlug`).
- `rss.ts` — RSS feed builder.

Use the `@/` path alias (`import { ... } from "@/lib/foo"`) inside
your `src/app/`, `src/components/`, etc. Do not use the alias inside
`nextly.config.ts` or files transitively loaded by it.
