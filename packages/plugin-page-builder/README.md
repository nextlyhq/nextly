# @nextlyhq/plugin-page-builder

A visual, block-based **page builder** for [Nextly](https://nextlyhq.com) — a minimal,
extensible foundation in the spirit of Gutenberg/Elementor. Drag-and-drop editing in an
iframe canvas, per-block styling with responsive overrides, a data-driven Query Loop, and
a server-first renderer that ships zero client JS by default.

> **Status:** alpha. The block model, registries, and render pipeline are stable; the
> editor interactions are evolving. MIT-licensed.

## Install

```bash
pnpm add @nextlyhq/plugin-page-builder
```

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

This contributes a `pages` collection (title, slug, `content` block tree, `customCss`,
draft/publish status) whose Edit view is the page builder.

### 2. Add the public render route

A plugin can't inject Next.js routes, so the consuming app declares **one** catch-all
route and hands the stored block tree to `PageRenderer`. The renderer never imports the
CMS runtime — you inject a small `dataProvider` backed by `getNextly()`:

```tsx
// app/(site)/[...slug]/page.tsx
import {
  PageRenderer,
  type DataProvider,
} from "@nextlyhq/plugin-page-builder/render";
import { notFound } from "next/navigation";
import { getNextly } from "nextly";
import nextlyConfig from "../../../../nextly.config";

function dataProvider(nx: Awaited<ReturnType<typeof getNextly>>): DataProvider {
  return {
    find: async args => ({ items: (await nx.find(args as never)).items ?? [] }),
    findOne: async ({ collection, id }) =>
      (await nx.findByID({ collection, id })) ?? null,
    resolveMedia: async () => null,
  };
}

export default async function SitePage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const nx = await getNextly({ config: nextlyConfig });
  const { items } = await nx.find({
    collection: "pages",
    where: {
      slug: { equals: slug.join("/") },
      status: { equals: "published" },
    },
    limit: 1,
  });
  const page = items[0] as
    | { content?: unknown; customCss?: string }
    | undefined;
  if (!page?.content) notFound();
  return (
    <PageRenderer
      document={page.content as never}
      customCss={page.customCss}
      dataProvider={dataProvider(nx)}
    />
  );
}
```

## Field mount (collections **and** singles)

Use the builder as a **field** alongside other fields — in any collection or single:

```ts
import { pageBuilderField } from "@nextlyhq/plugin-page-builder";
import { defineSingle, text } from "nextly/config";

export const Homepage = defineSingle({
  slug: "homepage",
  label: { singular: "Homepage" },
  fields: [
    text({ name: "title" }),
    pageBuilderField("layout", { label: "Layout" }),
  ],
});
```

`pageBuilderField` stores the block tree as JSON and mounts the editor via the field's
`admin.component`. The **host form** persists it (no separate save button). Render it the
same way — hand the field's value to `PageRenderer` (for a single, fetch via
`nx.findSingle({ slug })`).

## Per-entry editor choice (Default vs Page Builder)

Let **each entry** of a collection or single choose between the normal Nextly fields and the
visual Page Builder canvas — Elementor/WordPress-style.

**Code-first:** wrap the config with `withPageBuilder()`. It adds an `editorMode` select + the
reserved `content` page-builder field, and sets `admin.pageBuilder.enabled`:

```ts
import { withPageBuilder } from "@nextlyhq/plugin-page-builder";
import { defineCollection, text, textarea } from "nextly/config";

export const Articles = defineCollection(
  withPageBuilder({
    slug: "articles",
    labels: { singular: "Article", plural: "Articles" },
    status: true,
    fields: [
      text({ name: "title", required: true }),
      text({ name: "slug", required: true, unique: true }),
      textarea({ name: "excerpt" }),
    ],
  })
);
```

**UI-created collections/singles:** open the schema builder → toggle **"Use Page Builder"**
(shown only when this plugin is installed). It adds/removes the same two fields.

When an entry picks **Page Builder**, the edit screen shows the canvas plus the essentials
(title, slug, status); the other fields are hidden. Picking **Default** shows the normal form.

**Front-end** — render whichever the entry chose:

```tsx
import { PageRenderer } from "@nextlyhq/plugin-page-builder/render";

const article = await nx.findOne({ collection: "articles", where: { slug } });
export default function Article() {
  return article.editormode === "builder" ? (
    <PageRenderer
      document={article.content}
      registry={registry}
      dataProvider={dp}
    />
  ) : (
    <NormalArticle entry={article} />
  ); // your normal-fields template
}
```

## Built-in blocks

`core/heading`, `core/paragraph`, `core/image`, `core/button`, `core/video`,
`core/container`, `core/grid`, and the dynamic `core/query-loop`. Each declares content
fields (Content tab) and style controls (Style/Responsive tabs) that drive the inspector.

## Query Loop

Drop a **Query Loop**, set its collection/sort/limit, and place a template inside it. At
render the loop fetches entries through your `dataProvider` and renders the template once
per item. Bind any content field on a nested block to an item field (Content tab → **Bind**
→ path, e.g. `title` or `author.name`) — bindings resolve at any depth. Empty / error /
config states are first-class, and a per-page query budget bounds nested loops.

## Styling, tokens & responsive

Style values are **typed** (spacing as box-sides, colors, dimensions, …) and compiled to a
single scoped `<style>` per page via a real CSS parser (never string concatenation).
Colors may be raw values or design-token references (`{ token: "color.primary" }` →
`var(--nx-color-primary)`). Breakpoints are desktop-first; per-breakpoint overrides are
edited in the **Responsive** tab and visible at real device widths in the iframe canvas.

Page-level **custom CSS** is parsed, allow-listed, and scoped under the page root — no
`@import`, no `javascript:` urls, no `</style>` breakout.

## Extending — add your own block

The block registry is the single extensibility seam. One `defineBlock` call wires the
validator, renderer, and inspector — no core edit:

```tsx
import { defineBlock } from "@nextlyhq/plugin-page-builder";

defineBlock({
  type: "acme/pricing-table", // must be namespaced
  version: 1,
  label: "Pricing Table",
  icon: "Table",
  category: "basic",
  defaultProps: { plan: "Pro" },
  contentFields: [{ name: "plan", type: "text", label: "Plan" }],
  styleControls: [
    { control: "color", styleKey: "backgroundColor", label: "Background" },
  ],
  render: ({ props, className }) => (
    <div className={className}>{String(props.plan)}</div>
  ),
});
```

Blocks can bump `version` and ship a pure `migrate(old, fromVersion)` — stored documents
upgrade on read, and unknown blocks are preserved (never dropped).

## Security

- Text is escaped; image/link/video URLs are scheme-validated (rejects `javascript:` /
  `vbscript:` / `data:`, including control-char-obfuscated variants).
- Custom CSS is parser-validated, scoped, and allow-listed.
- Structural limits: max depth, max node count, unique ids, no move-into-descendant,
  namespaced types, slot allow-lists.
- The `./render` entry imports no CMS runtime and no admin code (enforced by a test).

## Package entries

- `.` — isomorphic core (registries, tree/validate/migrate, `pageBuilder`, `pageBuilderField`).
- `./render` — server-first `PageRenderer` (+ `DataProvider`).
- `./admin` — the React editor (registers its components on import).
- `./styles/editor.css` — editor styles.

## Environment note

Two steps require a real terminal (not a headless CI sandbox): applying the plugin's DB
table (drizzle push needs a TTY) and the `@nextlyhq/plugin-sdk` default/CJS export used by
the dev auto-seed. Everything else — build, type-check, unit tests — runs anywhere. See
the `e2e/` suite for the browser interaction tests (run against a live playground).
