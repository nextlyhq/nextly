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

`createBlocksPage()` turns a collection of block documents into rendered pages.

It composes the existing content-route factory with the block renderer: the route resolves a path to an entry and owns `generateStaticParams`, `generateMetadata` and the not-found decisions, and this fills in the render. Media ids and entry references resolve against the CMS, so images and links work without wiring either by hand.

```tsx
const { ContentPage, generateMetadata, generateStaticParams } =
  createBlocksPage({ collections: ["pages"], field: "content" });

export { generateMetadata, generateStaticParams };
export default ContentPage;
```

It lives at `@nextlyhq/blocks-react/next`, so importing the renderer itself still pulls in neither Next nor the CMS. `nextly` is an optional peer dependency, and a test asserts the package root reaches no part of it.

`getNextly` is exported from `nextly/runtime`. It is already the documented default for `ContentRouteConfig.nextly`, and a helper built on a content route needs the same instance the route reads through — on a per-tenant setup a second instance is a second database. Exporting it lets such a helper resolve one the same way, rather than having the route hand a general reader to every callback in order to share one.

A page's blocks now supply its metadata when the entry's SEO fields are blank.

`BlockDefinition` gains an optional `seo?(props)` returning a title, description and/or image. A block declares what it offers rather than a deriver guessing from prop names — a guessing deriver works for the core library and goes silent for every contributed block, which is backwards: a page built mostly from third-party blocks is exactly the one with nothing else to fall back on. Core heading, text and image blocks declare theirs.

`createBlocksPage` gains a `metadata` hook receiving what the document said about itself:

```ts
metadata: (entry, ctx, derived) => buildMetadata(entry, { fallback: derived });
```

Each field is filled from the FIRST block that offers it, independently, so a page opening with an image and heading later takes both. The offer is synchronous by design, so generating metadata never puts a network call between a crawler and the page title; a derived media id is resolved afterward through the same resolver the rendered image uses, so the picture in a link preview and the picture on the page cannot disagree.

The sitemap needed no change: `nextlySitemap` already takes a generic entries provider, and a blocks-backed collection is an ordinary collection.

`prepareDocumentForRead` is now exported from `@nextlyhq/blocks-react`. It runs the passes a stored document goes through before anything reads it — the format guard, shape repair against the site's caps, migration, condition gating, address repair and placeholder pruning — and returns the tree the page will actually present, or `null` when the page presents nothing but a placeholder.

`slugToStaticParam` is now exported from `nextly/runtime`, and it is the route's single answer to "what path does this stored slug render at". Anything emitting a URL for an entry — a canonical, a link between entries — derives it from that function rather than re-deriving the rule, because a second opinion names a path the route does not serve.

It also now **refuses a slug holding a literal `.` or `..` segment**. URL resolution removes those segments before the request is sent, so a page pre-rendered at `/pages/../admin` is fetched as `/admin` and can never be reached, while occupying a path that belongs to a different and possibly reserved route. Only a segment that is entirely dots is affected — `docs/v1.2/guide` is an ordinary path, and so is a slug whose segment literally contains `%2E`, since stored text reaches a URL already encoded and comes back unchanged.

`createBlocksPage` now gives every render a finite `QueryBudget`, sized by `maxQueries` and defaulting to `DEFAULT_MAX_QUERIES` (500). `core/collection-loop` claims from that budget before each read and treats an absent one as unlimited, so a routed page nesting loops could multiply a single page view into millions of reads. The budget is created per render, never shared across requests, and `Infinity` opts out.

A block can declare slots it may decline to render, and the SEO derivation skips them. `core/collection-loop` declares its children: it draws them once per entry, so an empty query draws them none, while the stored document looks identical either way — its template's heading would otherwise title the page with content the page does not contain. The field is internal for now and deliberately absent from `@nextlyhq/plugin-sdk`; the shape a block author should write is a decision for the Block API freeze. It closes the class for the core library, not for a contributed block that renders conditionally and declares nothing.

`core/collection-loop` now queries in the locale the page is being rendered in, taken from the context. Without it a French page embedded default-locale rows: the surrounding blocks translated and the looped content silently did not.

`core/image` again distinguishes a MISSING `alt` from an explicitly empty one. An explicit `alt: ""` is the block's documented way to mark an image decorative and is emitted as written; only a placement that says nothing falls back to the media record's alt text.

`createBlocksPage` also accepts `hostPolicy` and forwards it to the renderer, so a document moved behind the route helper keeps the site-operator decisions the standalone renderer was given — such as which frame origins may keep `allow-same-origin`.

A derived canonical is now omitted, rather than guessed, when the slug is not addressable — one holding such a segment, a reserved path, or one whose normalized form the lookup would not match (`a//b` is answered by Next with a 308 to `/a/b`, and the lookup then asks for a slug the entry does not have). The key is absent rather than `undefined`, so spreading the derived result over a caller's own metadata cannot erase a canonical they already knew.

`prepareDocumentForRead` is public because `resolvePageStyles` is. That function is documented against the document that will RENDER, and this is the only thing that produces one, so a caller previously had to reimplement the renderer's passes to satisfy the precondition. Pruning gated nodes alone is not enough: it yields a tree LARGER than the page shows, and styles resolved against it ship rules for nodes the render drops.
