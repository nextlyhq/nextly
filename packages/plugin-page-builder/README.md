# @nextlyhq/plugin-page-builder

A visual, block-based **page builder** for [Nextly](https://nextlyhq.com) — a minimal,
extensible foundation in the spirit of Gutenberg/Elementor. Drag-and-drop editing in an
iframe canvas, per-block styling with responsive overrides, a data-driven Query Loop, and
a server-first renderer that ships zero client JS by default.

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0 — pin exact versions in production.
> See the [plugin stability ladder](https://nextlyhq.com/docs/plugins/stability) for
> which plugin surfaces are stable and which are experimental.

The block model, registries, and render pipeline are stable; the editor interactions
are still evolving.

## Install

```bash
pnpm add @nextlyhq/plugin-page-builder @nextlyhq/builder @nextlyhq/plugin-sdk react-hook-form
```

Those three are **peer dependencies** that a scaffolded Nextly app does not already
have, so install them explicitly rather than relying on your package manager to
auto-install peers. The plugin's other peers — `@nextlyhq/admin`, `@nextlyhq/ui`,
`@tanstack/react-query`, `lucide-react`, `nextly`, `next`, `react`, `react-dom` — come
with the scaffold.

Peers (provided by a Nextly app): `nextly`, `@nextlyhq/admin`, `@nextlyhq/ui`,
`@nextlyhq/plugin-sdk`, `react`, `react-dom`, `next`, `@tanstack/react-query`,
`react-hook-form`, `lucide-react`.

## Quick start

### 1. Register the plugin

```ts
// nextly.config.ts
import { pageBuilder } from "@nextlyhq/plugin-page-builder";
import { defineConfig } from "nextly/config";

export default defineConfig({
  plugins: [pageBuilder()], // adds a `pages` collection with the full editor
});
```

This contributes a `pages` collection (title, slug, `content` block tree,
draft/publish status) whose Edit view is the page builder.

### 2. Add the public render route

A plugin cannot inject Next.js routes, so the consuming app declares **one** catch-all
route. `createBlocksPage` fills its body: it resolves the path against your collections,
404s on a miss or a reserved path, and renders the stored document.

Install the renderer in your own app rather than relying on it being present underneath
this plugin:

```bash
npm install @nextlyhq/blocks-react
```

```tsx
// app/(frontend)/[...slug]/page.tsx
import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { createBlocksPage } from "@nextlyhq/blocks-react/next";
import { getNextly } from "nextly";
import type { NextlyContentReader } from "nextly/runtime";

import nextlyConfig from "../../../nextly.config";

type NextlyInstance = Awaited<ReturnType<typeof getNextly>>;

// Per call rather than once: a public page can be the first request a cold server
// handles. `getNextly` caches, so later calls are a lookup.
const instance = () => getNextly({ config: nextlyConfig });

const reader: NextlyContentReader & {
  media: Pick<NextlyInstance["media"], "findByID">;
} = {
  find: async args => (await instance()).find(args),
  findByID: async args => (await instance()).findByID(args),
  // Images storing a media id resolve through this; omit it and they draw nothing
  // while images with a literal URL keep working.
  media: {
    findByID: async args => (await instance()).media.findByID(args),
  },
};

const { ContentPage, generateMetadata } = createBlocksPage({
  collections: ["pages"],
  field: "content",
  nextly: reader,
  blocks: createBlockResolver(coreBlocks),
  // Without a breakpoint set the renderer emits class names with no CSS behind
  // them, and the page comes out structurally correct and visually bare.
  styleContext: {
    breakpoints: {
      viewport: [
        { id: "base", label: "Base" },
        { id: "tablet", label: "Tablet", maxWidth: 1024 },
        { id: "mobile", label: "Mobile", maxWidth: 640 },
      ],
      container: [],
    },
  },
});

export { generateMetadata };
export default ContentPage;
```

`createBlocksPage` reads **access-enforced** content, so it needs no database during
`next build`. A wholly public site calls `createPublicBlocksPage` instead, which reads
trusted, pre-renders, and returns a `generateStaticParams` to export beside the other two.
The posture is the factory you call; there is no option for it.

## Field mount (collections **and** singles)

Use the builder as a **field** alongside other fields, in any collection or single:

```ts
import { blocks } from "@nextlyhq/plugin-page-builder";
import { defineSingle, text } from "nextly/config";

export const Homepage = defineSingle({
  slug: "homepage",
  label: { singular: "Homepage" },
  fields: [
    text({ name: "title" }),
    blocks({ name: "layout", label: "Layout", blocks: { allow: ["core/*"] } }),
  ],
});
```

`blocks()` stores a `BlockDocument` as JSON and mounts the editor through the field's
admin component. The **host form** persists it; there is no separate save button.

The field decides how an entry is edited, and nothing decides it per entry. An earlier
release shipped a stored `editorMode` select that let each entry choose between the normal
form and the builder. It is gone: a UI preference stored as content travelled in API
responses and exports, both editors' columns stayed live with only one of them rendered,
and it applied only to collections declared in code.

Render a single the same way you render a collection, reading it with
`nextly.findSingle({ slug })` and handing the field's value to the renderer.

## Built-in blocks

Nineteen, from `@nextlyhq/blocks-react/blocks`:

`core/accordion`, `core/accordion-item`, `core/box`, `core/button`,
`core/collection-loop`, `core/card`, `core/column`, `core/columns`, `core/divider`,
`core/embed`, `core/form`, `core/gallery`, `core/heading`, `core/image`, `core/list`,
`core/quote`, `core/section`, `core/spacer`, `core/text`.

Each declares its props (Content tab) and which style groups it supports, and those drive
the inspector.

## Collection Loop

Drop a **`core/collection-loop`**, set its collection, sort and limit, and place a template
inside it. At render the loop fetches entries through the route's data access and renders
the template once per item. Bind any prop on a nested block to an item field (Content tab →
**Bind** → path, for example `title` or `author.name`); bindings resolve at any depth.
Empty, error and unconfigured states are first-class, and a per-page query budget bounds
nested loops — depth in a document becomes multiplication in reads.

## Styling, tokens & responsive

Style values are **typed** (spacing as box-sides, colors, dimensions, …) and compiled to a
single scoped `<style>` per page via a real CSS parser (never string concatenation).
Colors may be raw values or design-token references (`{ token: "color.primary" }` →
`var(--nx-color-primary)`). Breakpoints are desktop-first; per-breakpoint overrides are
edited in the **Responsive** tab and visible at real device widths in the iframe canvas.

## Extending — add your own block

The block registry is the extensibility seam. One `defineBlock` call describes the
props, the editor metadata and the renderer:

```tsx
import { defineBlock } from "@nextlyhq/plugin-sdk/blocks";

export const pricingTable = defineBlock({
  name: "acme/pricing-table", // must be namespaced
  version: 1,
  description: "A plan comparison table.",
  editor: {
    label: "Pricing Table",
    category: "content",
    keywords: ["plan", "pricing"],
  },
  props: {
    plan: { type: "text" },
  },
  defaultProps: { plan: "Pro" },
  supports: { typography: true, color: true, spacing: true },
  render: ({ props, className }) => (
    <div className={className}>{String(props.plan)}</div>
  ),
});
```

Hand it to the route beside the core set so the public page can draw it:

```ts
blocks: createBlockResolver([...coreBlocks, pricingTable]);
```

Pass an explicit set rather than relying on the process-wide registry: that registry is
populated by whatever booted the editor, so a public route depending on it renders the
unknown-block placeholder whenever a visitor arrives before an admin does.

Blocks may bump `version` and ship a pure `migrate(old, fromVersion)`, and unknown blocks
are preserved rather than dropped. Migration runs when the **editor** loads a document, so
where it PERSISTS depends on the mount: a field mount keeps the value the host form was
given, and the upgrade reaches storage with the author's first real edit. The published
page does not migrate at all — it draws the stored document as it is. So a block reads its
props defensively whatever version wrote them, which it must do anyway for a hand-edited or
API-authored document. Migration only ever moves a document FORWARD: a node written by a
newer definition than this build registers is left exactly as found.

## Security

- Text is escaped; image/link/video URLs are scheme-validated (rejects `javascript:` /
  `vbscript:` / `data:`, including control-char-obfuscated variants).
- There is no author-written CSS surface. A `customCss` field existed, gated by
  its own permission, and nothing rendered or sanitized what it stored; it was
  removed rather than left one line away from reaching a page.
- Structural limits: max depth, max node count, unique ids, no move-into-descendant,
  namespaced types, slot allow-lists.
- The renderer's root entry imports no CMS runtime, no admin code and no `next/*`
  (enforced by a layering test), so it is usable standalone.

## Package entries

- `.` — isomorphic, React-free registration surface (`pageBuilder`, `blocks`,
  `pagesCollection`, the document types).
- `./blocks` — the blocks this plugin contributes.
- `./admin` — the React editor (registers its components on import).
- `./styles/editor.css` — editor styles.

Rendering lives in `@nextlyhq/blocks-react`, and the document model in
`@nextlyhq/blocks-engine`. This package registers them rather than reimplementing them.

## Environment note

Two steps require a real terminal (not a headless CI sandbox): applying the plugin's DB
table (drizzle push needs a TTY) and the `@nextlyhq/plugin-sdk` default/CJS export used by
the dev auto-seed. Everything else — build, type-check, unit tests — runs anywhere. See
the `e2e/` suite for the browser interaction tests (run against a live playground).

## Related packages

- [`@nextlyhq/blocks-engine`](../blocks-engine) — the stored document model
- [`@nextlyhq/blocks-react`](../blocks-react) — the renderer for public pages
- [`@nextlyhq/builder`](../builder) — the editor shell and canvas
- [`@nextlyhq/plugin-sdk`](../plugin-sdk) — the SDK this plugin is built on

## License

[MIT](../../LICENSE.md)
