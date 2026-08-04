# @nextlyhq/blocks-react

The React renderer for Nextly block documents.

A block document is plain JSON validated by
[`@nextlyhq/blocks-engine`](../blocks-engine). This package turns one into a
React tree, as Server Components, with no client JavaScript unless a block opts
into it.

> **Alpha.** The public surface is not yet stable.

## Two entries, and why

```ts
import { PageRenderer } from "@nextlyhq/blocks-react"; // React only
import { createBlocksPage } from "@nextlyhq/blocks-react/next"; // Next.js
```

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

```ts
import { createStandaloneContext } from "@nextlyhq/blocks-react";

const ctx = createStandaloneContext({
  data: { find: async () => ({ items: myPosts }) },
  resolveMediaUrl: id => `/uploads/${id}`,
});
```

The CMS supplies an implementation backed by its own read path. Tests supply
fixtures. The editor canvas supplies its own. One seam, four consumers.

## Status

`R-1` of implementation plan 03 lands the package boundary and its guarantees.
`PageRenderer` arrives in `R-2`.
