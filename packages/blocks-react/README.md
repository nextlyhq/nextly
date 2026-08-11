# @nextlyhq/blocks-react

The React renderer for Nextly block documents.

A block document is plain JSON validated by
[`@nextlyhq/blocks-engine`](../blocks-engine). This package turns one into a
React tree, as Server Components, with no client JavaScript unless a block opts
into it.

> **Alpha.** The public surface is not yet stable.

## Two entries, and why

| Entry                         | Contains                              | Exported today                                                                                    |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@nextlyhq/blocks-react`      | the renderer and the context contract | `PageRenderer`, `BlockBoundary`, the core block library, context types, `createStandaloneContext` |
| `@nextlyhq/blocks-react/next` | everything that needs `next/*`        | `createBlocksPage`                                                                                |

Render a document anywhere:

```ts
import { PageRenderer } from "@nextlyhq/blocks-react";
```

Or turn a collection of documents into pages, in `app/[[...slug]]/page.tsx`:

```tsx
import { createBlocksPage } from "@nextlyhq/blocks-react/next";

const { ContentPage, generateMetadata } = createBlocksPage({
  collections: ["pages"],
  field: "content",
});

export { generateMetadata };
export default ContentPage;
```

Access rules decide who may read, so the page renders per request. If the
content in those collections is **public**, say so and the route pre-renders
instead:

```tsx
import { createPublicBlocksPage } from "@nextlyhq/blocks-react/next";

const { ContentPage, generateMetadata, generateStaticParams } =
  createPublicBlocksPage({ collections: ["pages"], field: "content" });

export { generateMetadata, generateStaticParams };
export default ContentPage;
```

The route resolves each path to an entry, renders its document, and wires media
ids and entry references to the CMS so images and internal links work without
being wired by hand. `nextly` is an OPTIONAL peer dependency, needed only for
this entry.

The root entry imports **no `next/*`, no admin code and no CMS runtime**. You
can render a document from a plain React app, a test, or a script with nothing
else installed — the CMS is one way to produce documents, not a requirement for
rendering them.

Everything Next-coupled lives at `/next`, so importing the renderer never pulls
Next into your module graph. `src/layering.test.ts` enforces both rules as a
build failure rather than a convention.

## Data, media and links

Blocks never reach for a database. Anything from the outside world arrives
through `PageContext`:

This part works today:

```ts
import { createStandaloneContext } from "@nextlyhq/blocks-react";

const ctx = createStandaloneContext({
  data: { find: async () => ({ items: myPosts }) },
  // Async, and a media object rather than a URL: an image block needs alt text
  // and intrinsic dimensions to render without layout shift.
  resolveMedia: async id => ({ url: `/uploads/${id}`, alt: "" }),
  resolveEntryPath: async (collection, id) => `/${collection}/${id}`,
});
```

The CMS supplies an implementation backed by its own read path. Tests supply
fixtures. The editor canvas supplies its own. One seam, four consumers.

## Status

Alpha. `PageRenderer`, the core block library and `createBlocksPage` all ship,
alongside the package boundary, its layering guarantees and the `PageContext`
contract. The editor surfaces follow.
