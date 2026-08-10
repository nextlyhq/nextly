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

`render` and `buildMetadata` now also receive the reader the route resolved the entry through, as `context.reader`. A render that needs a second read — a referenced author, the media behind an image — no longer has to obtain an instance of its own, which on a per-tenant setup would be a different database.

A page's blocks now supply its metadata when the entry's SEO fields are blank.

`BlockDefinition` gains an optional `seo?(props)` returning a title, description and/or image. A block declares what it offers rather than a deriver guessing from prop names — a guessing deriver works for the core library and goes silent for every contributed block, which is backwards: a page built mostly from third-party blocks is exactly the one with nothing else to fall back on. Core heading, text and image blocks declare theirs.

`createBlocksPage` gains a `metadata` hook receiving what the document said about itself:

```ts
metadata: (entry, ctx, derived) => buildMetadata(entry, { fallback: derived });
```

Each field is filled from the FIRST block that offers it, independently, so a page opening with an image and heading later takes both. The offer is synchronous by design, so generating metadata never puts a network call between a crawler and the page title; a derived media id is resolved afterward through the same resolver the rendered image uses, so the picture in a link preview and the picture on the page cannot disagree.

The sitemap needed no change: `nextlySitemap` already takes a generic entries provider, and a blocks-backed collection is an ordinary collection.

`prepareDocumentForRead` is now exported from `@nextlyhq/blocks-react`. It runs the passes a stored document goes through before anything reads it — the format guard, shape repair against the site's caps, migration, condition gating, address repair and placeholder pruning — and returns the tree the page will actually present, or `null` when the page presents nothing but a placeholder.

It is public because `resolvePageStyles` is. That function is documented against the document that will RENDER, and this is the only thing that produces one, so a caller previously had to reimplement the renderer's passes to satisfy the precondition. Pruning gated nodes alone is not enough: it yields a tree LARGER than the page shows, and styles resolved against it ship rules for nodes the render drops.
