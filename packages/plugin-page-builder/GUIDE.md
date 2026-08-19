# Page Builder Plugin — Install & Usage Guide

A visual, drag-and-drop page builder for Nextly. Editors get a block-based canvas
(headings, paragraphs, buttons, images, grids, and more) with a live preview and
per-device (desktop / tablet / mobile) views — right inside the Nextly admin.

This guide takes you from **installing** the plugin, to **configuring** your app,
to **opening and using** the builder. No prior knowledge of the plugin is assumed.

---

## Before you start

You need an existing **Nextly** app. If you don't have one yet, create it first:

```bash
npx create-nextly-app@latest my-app
cd my-app
```

Pick **SQLite** when the scaffolder asks for a database — it needs no setup and is
perfect for experimenting.

> **Which package manager?** The examples below use `npm`. If your project uses
> `pnpm` or `yarn`, swap the install commands accordingly (`pnpm add …`,
> `yarn add …`). Everything else is identical.

---

## Step 1 — Install the plugin

From the root of your Nextly app, run:

```bash
npm install @nextlyhq/plugin-page-builder
```

That's it — the plugin and the pieces it depends on are now in your project.

> ### ⚠️ Temporary note (remove once the next version is published)
>
> The version currently on npm was published with a dependency mismatch, so a
> plain install may fail with an `ERESOLVE` error. Until the fixed version ships,
> install with:
>
> ```bash
> npm install @nextlyhq/plugin-page-builder @nextlyhq/builder --legacy-peer-deps
> ```
>
> `@nextlyhq/builder` is named explicitly on purpose. `--legacy-peer-deps` tells
> npm to skip peer dependencies altogether, and the editor's chrome is a peer that
> this plugin imports at runtime — so the flag on its own gives you an install that
> resolves and then fails when the editor loads. Asking for it by name puts it back.
>
> This is safe for experimenting. Once the corrected version is released, the plain
> command above works and you can delete this note.

---

## Step 2 — Configure `next.config.ts` (the important one)

This is the step people most often get wrong, so do it carefully. Open
`next.config.ts` in your app and make sure the page-builder plugin is listed under
**`transpilePackages`**:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages ship as modern JS that Next.js needs to compile for you.
  // The page-builder's editor is a UI component, so it MUST go here.
  transpilePackages: [
    "@nextlyhq/admin",
    "@nextlyhq/ui",
    "@nextlyhq/plugin-page-builder",
  ],

  // Server-only / native packages Next.js should NOT try to bundle.
  // Note: the page-builder plugin is deliberately NOT in this list.
  serverExternalPackages: [
    "nextly",
    "@nextlyhq/adapter-drizzle",
    "@nextlyhq/adapter-sqlite",
    "drizzle-orm",
    "drizzle-kit",
    "bcryptjs",
    "sharp",
    "esbuild",
    "bundle-require",
    "better-sqlite3",
  ],
};

export default nextConfig;
```

**Why this matters, in plain terms:** the page builder's editor is a piece of the
admin _user interface_. Next.js needs to compile and bundle it like any other UI
code (that's what `transpilePackages` does). If you instead put it under
`serverExternalPackages`, you're telling Next.js "leave this alone, the server will
load it directly" — and the editor then fails to load with errors like
`Can't resolve '@nextlyhq/plugin-sdk'` or `Cannot find module 'next/link'`. So the
rule is simple:

- ✅ Put `@nextlyhq/plugin-page-builder` in **`transpilePackages`**.
- ❌ Do **not** put it (or `@nextlyhq/plugin-sdk`) in `serverExternalPackages`.

> If your `serverExternalPackages` list already has different database adapters
> (e.g. Postgres instead of SQLite), keep yours — only the two page-builder rules
> above matter.

---

## Step 3 — Register the plugin in `nextly.config.ts`

Open `nextly.config.ts` and add the plugin. You import it, then list it under
`plugins`:

```ts
import { pageBuilder } from "@nextlyhq/plugin-page-builder";
import { defineConfig, text, textarea } from "nextly/config";

export default defineConfig({
  admin: {
    branding: { logoText: "My App" },
  },

  // Your own collections stay exactly as they are.
  collections: [
    {
      slug: "articles",
      labels: { singular: "Article", plural: "Articles" },
      fields: [
        text({ name: "title", required: true }),
        textarea({ name: "summary" }),
      ],
    },
  ],

  // 👇 add the page builder here
  plugins: [pageBuilder()],
});
```

You **don't** need to define a "pages" collection yourself — the plugin adds a
ready-to-use **Pages** collection automatically once it's registered.

---

## Step 4 — Sync the database

The plugin adds a new **Pages** table. Apply that to your database with one command:

```bash
npx nextly db:sync
```

`db:sync` applies your current schema (including the plugin's new **Pages**
table) directly. It is the command for first-time setup — `nextly migrate` only
runs committed migration files, of which a fresh app has none yet. You should
see it connect and finish successfully. (With SQLite this creates a local
database file — nothing else to set up.)

---

## Step 5 — Start the app

```bash
npm run dev
```

Wait for `Ready` in the terminal, then open the admin in your browser:

```text
http://localhost:3000/admin
```

_(If port 3000 is busy, Next.js will pick another one — check the terminal for the
exact URL.)_

---

## Step 6 — Open and use the page builder

### 6.1 First-time setup

The very first time you open `/admin`, you'll be asked to **create an admin
account** (name, email, password). Fill it in and submit — this is your login for
the CMS.

### 6.2 Find the Pages collection

After logging in you'll land on the dashboard. In the left sidebar (or on the
dashboard cards) you'll see a **Pages** collection — that's the one the plugin
added. Click it, then click **New Page** (or **Create Page**).

### 6.3 The builder opens automatically

There is no editor switch. Whether a page is edited visually is decided by the
FIELD on the collection rather than per entry: the plugin's `pages` collection
declares a blocks field named `content`, so opening a page shows the builder
canvas.

An earlier release stored that choice per page in an `editorMode` column. It is
gone. A UI preference stored as content travelled in API responses and exports and
could be set by any writer, and both editors' content persisted at once with only
one of them ever shown.

### 6.4 Build the page

The builder has three areas:

| Area                 | What it's for                                                                                                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Left — Blocks**    | The nineteen building blocks: Heading, Text, Button, Section, Box, Columns, Column, Card, Image, Gallery, Embed, List, Quote, Accordion, Accordion item, Divider, Spacer, Form and Collection loop. Click **Insert** (or drag) to add one to the canvas. |
| **Middle — Canvas**  | A live preview of your page. Click any block to select it. Use the **Desktop / Tablet / Mobile** buttons on top to preview different screen sizes.                                                                                                       |
| **Right — Settings** | When a block is selected, its options appear here (e.g. a Heading's text and level H1–H6), organized into **Content**, **Style**, and **Advanced** tabs.                                                                                                 |

Try it: insert a **Heading**, then edit its text and level in the Settings panel on
the right. You'll see the canvas update immediately.

### 6.5 Save and publish

Use **Save Draft** to keep your work in progress, or **Publish** to make the page
live. Give the page a **title** (top-left) and a **slug** (the URL path) before
publishing.

---

## Step 7 — Show your pages on the public website (frontend)

Everything so far happens inside the admin. The builder **saves each page into your
database**, but it does not create the public web page. You add **one** small route
to your app, and from then on every page your team publishes is served
automatically, with no further code and no deploy.

This is the "pages collection" model: the page's **slug** is its URL. An author
creates a page, types `about`, publishes, and `/about` is live.

### 7.1 Install the renderer

The route draws block documents, which is `@nextlyhq/blocks-react`'s job. Add it to
your app's own dependencies rather than relying on it being installed underneath
the plugin — package managers do not guarantee that a dependency of a dependency is
importable from your code.

```bash
npm install @nextlyhq/blocks-react
```

### 7.2 Create the route file

Create this file in your app:

```text
src/app/(frontend)/[...slug]/page.tsx
```

- `(frontend)` is a **route group**. The parentheses mean it does not appear in the
  URL; it only keeps your public pages separate from `/admin` in the file tree.
- `[...slug]` is a **catch-all**: it matches any path (`/about`, `/pricing`,
  `/pricing/enterprise`, …) and hands it to your code.

Use `[...slug]` with single brackets when your app already has its own `/` page,
which most do. The optional form `[[...slug]]` matches the site root as well, and
two routes claiming `/` is a build error rather than a question of precedence.

### 7.3 Paste this code

```tsx
import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { createBlocksPage } from "@nextlyhq/blocks-react/next";
import { getNextly } from "nextly";
import type { NextlyContentReader } from "nextly/runtime";

// Adjust the number of "../" so this points at your project's nextly.config file.
import nextlyConfig from "../../../nextly.config";

type NextlyInstance = Awaited<ReturnType<typeof getNextly>>;

// Resolved per call, not once. A public page can be the very first request a cold
// server handles, so a value captured at module scope would work only after
// something else had booted the CMS. `getNextly` caches, so later calls are a
// lookup.
const instance = () => getNextly({ config: nextlyConfig });

const reader: NextlyContentReader & {
  media: Pick<NextlyInstance["media"], "findByID">;
} = {
  find: async args => (await instance()).find(args),
  findByID: async args => (await instance()).findByID(args),
  // Images that store a media id resolve through this. Leave it out and every
  // such image renders nothing, while images with a literal URL still work —
  // which makes it look like a content problem rather than a wiring one.
  media: {
    findByID: async args => (await instance()).media.findByID(args),
  },
};

const { ContentPage, generateMetadata } = createBlocksPage({
  // The collection the plugin contributes. It already has a unique `slug` and a
  // Draft/Published lifecycle, so an unpublished page 404s rather than rendering.
  collections: ["pages"],
  // The blocks field on that collection. Named rather than guessed: a wrong guess
  // renders a blank page instead of raising an error.
  field: "content",
  nextly: reader,
  // An explicit set rather than the global registry, which is populated by
  // whatever booted the editor — so a public route that relies on it renders
  // placeholders whenever a visitor arrives before an admin does.
  blocks: createBlockResolver(coreBlocks),
  // Your site's breakpoints. The renderer always emits class NAMES and emits CSS
  // only when it has something to compile from, so without this the page comes
  // out structurally correct and visually bare. The base tier carries no
  // `maxWidth`: it is the fallback the others narrow.
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

### 7.4 What this does, in plain terms

1. It reads the URL (`/about` → slug `"about"`).
2. It asks Nextly for the **published** page with that slug.
3. If there is not one, it shows a **404**.
4. If there is, it hands the saved blocks to the renderer, which turns them back
   into a real web page — and returns the page's SEO metadata to Next as well.

You do **not** need extra `next.config` changes for this: the plugin is already in
`transpilePackages` from Step 2.

Two things the helper does that are easy to miss. It refuses **reserved paths**, so
a page saved with the slug `admin` or `api` 404s here instead of shadowing your
admin panel. And it reads content **as the visitor would**, enforcing your access
rules on every request, which is why it needs no database at build time.

### 7.5 See it live

1. In the admin, open a page, give it a slug (for example `about`), and click
   **Publish**.
2. Visit `http://localhost:3000/about`.

Your built page is now served to the public.

### 7.6 Structured content needs its own route

The catch-all above is for **free-form pages** — the ones an author invents without
asking a developer. Content with a predictable URL shape, such as blog posts under
`/blog/...`, is better served by its own route file (`src/app/(frontend)/blog/[slug]/page.tsx`)
that renders the fields you designed for it. Next.js matches more specific routes
first, so the two live side by side with nothing to configure.

### 7.7 Going faster: pre-built pages

`createBlocksPage` renders on each request. For a public marketing site, swap it
for `createPublicBlocksPage`, which pre-renders pages at build time and returns a
`generateStaticParams` for you to export alongside the other two:

```tsx
const { ContentPage, generateMetadata, generateStaticParams } =
  createPublicBlocksPage({
    /* the same options, plus: */
    // A write to the collection busts these, so publishing updates the live page
    // immediately instead of waiting for the next deploy.
    tags: ["pages"],
  });

export { generateMetadata, generateStaticParams };
export default ContentPage;
```

Two things change with it, and both are deliberate. It reads content **without**
enforcing access rules, on the assumption that everything in the collection is
public — so do not point it at a collection that is not. And it reads your database
during `next build`, which means your build environment needs one.

The posture is the factory you call. There is no option to flip.

---

## Troubleshooting

**Install fails with `ERESOLVE` / peer dependency error**
See the temporary note in Step 1. Install with `--legacy-peer-deps` for now, and
name `@nextlyhq/builder` alongside the plugin — the flag skips peers, and that one
is a peer the editor needs at runtime.

**The `/admin` page or editor shows an error like `Can't resolve '@nextlyhq/plugin-sdk'`
or `Cannot find module 'next/link'`**
Your `next.config.ts` is wrong. The plugin must be in **`transpilePackages`** and
must **not** be in `serverExternalPackages`. Re-check Step 2, then restart the dev
server (stop it and run `npm run dev` again).

**Changes to `next.config.ts` don't seem to take effect**
Next.js only reads that file at startup. Stop the dev server and start it again.
If it still misbehaves, delete the `.next` folder and restart.

**No "Pages" collection appears in the admin**
Make sure you completed Step 3 (registered `pageBuilder()` in `nextly.config.ts`)
and Step 4 (`npx nextly db:sync`), then restart the dev server.

**Visiting your page URL shows a 404 (Step 7)**
Four things to check: (1) the page is **Published**, not just saved as a draft;
(2) the page's **slug** matches the URL you're visiting; (3) the `import
nextlyConfig from "../../.../nextly.config"` line has the right number of `../` to
reach your project's `nextly.config` file; (4) the slug is not a **reserved path** —
anything under `admin`, `api`, `_next` or `static`, and well-known files such as
`sitemap.xml`, are refused so content cannot shadow your admin panel.

**Visiting your page URL shows a blank page**
The page probably has no blocks yet, or was saved empty. Open it in the builder,
add at least one block, and Publish again.

---

## Quick reference

```bash
# 1. Install
npm install @nextlyhq/plugin-page-builder        # see Step 1 if this hits ERESOLVE

# 2. next.config.ts  -> add plugin to transpilePackages (NOT serverExternalPackages)

# 3. nextly.config.ts -> plugins: [pageBuilder()]

# 4. Sync DB
npx nextly db:sync

# 5. Run
npm run dev

# 6. Open http://localhost:3000/admin  ->  Pages  ->  New Page

# 7. Frontend: npm install @nextlyhq/blocks-react, then add
#    src/app/(frontend)/[...slug]/page.tsx (see Step 7) to serve every page,
#    then visit http://localhost:3000/<your-page-slug>
```

Questions or something not working? Share the exact error from your terminal or
browser console and we'll sort it out.
