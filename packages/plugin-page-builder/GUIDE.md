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
> npm install @nextlyhq/plugin-page-builder --legacy-peer-deps
> ```
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

### 6.3 Switch between Normal and Page Builder

At the top-right of the page editor there's a small toggle with two options:

- **Normal** — a plain form (simple fields).
- **Page Builder** — the full visual editor.

Click **Page Builder**. The form is replaced by the builder canvas (this is the
"takeover" view). You can switch back to **Normal** at any time; your choice is
saved per page.

### 6.4 Build the page

The builder has three areas:

| Area                 | What it's for                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Left — Blocks**    | The building blocks: Paragraph, Heading, Button, Container, Grid, Image, Video, Query Loop. Click **Insert** (or drag) to add one to the canvas.         |
| **Middle — Canvas**  | A live preview of your page. Click any block to select it. Use the **Desktop / Tablet / Mobile** buttons on top to preview different screen sizes.       |
| **Right — Settings** | When a block is selected, its options appear here (e.g. a Heading's text and level H1–H6), organized into **Content**, **Style**, and **Advanced** tabs. |

Try it: insert a **Heading**, then edit its text and level in the Settings panel on
the right. You'll see the canvas update immediately.

### 6.5 Save and publish

Use **Save Draft** to keep your work in progress, or **Publish** to make the page
live. Give the page a **title** (top-left) and a **slug** (the URL path) before
publishing.

---

## Step 7 — Show your pages on the public website (frontend)

Everything so far happens inside the admin. The builder **saves each page into your
database** — but it does not automatically create the public web page. You add one
small route to your app that reads a page from the database (by its slug) and hands
it to the plugin's renderer. Do this once and **every** page your team builds is
served automatically.

### 7.1 Create the route file

Create this file in your app:

```text
src/app/(site)/[...slug]/page.tsx
```

- `(site)` is a route group — it just keeps your public pages separate from
  `/admin`. The parentheses mean it does **not** show up in the URL.
- `[...slug]` is a **catch-all**: it matches any path (`/about`, `/pricing`,
  `/blog/hello`, …) and passes it to your code as the page's slug.

### 7.2 Paste this code

```tsx
import {
  PageRenderer,
  type DataProvider,
} from "@nextlyhq/plugin-page-builder/render";
import { notFound } from "next/navigation";
import { getNextly } from "nextly";

// Adjust the number of "../" so this points at your project's nextly.config file.
import nextlyConfig from "../../../../nextly.config";

// Pages live in the database, so render them fresh on each request instead of
// trying to pre-build them (the build machine has no database).
export const dynamic = "force-dynamic";

type NextlyInstance = Awaited<ReturnType<typeof getNextly>>;

// The renderer doesn't talk to your database directly — you give it this small
// adapter so it can fetch related content (e.g. a Query Loop block listing posts)
// and resolve media. This is the same for every project; copy it as-is.
function makeDataProvider(nx: NextlyInstance): DataProvider {
  return {
    find: async args => {
      const result = await nx.find(args as never);
      return { items: (result.items ?? []) as Record<string, unknown>[] };
    },
    findOne: async ({ collection, id }) => {
      const doc = await nx.findByID({ collection, id } as never);
      return (doc ?? null) as Record<string, unknown> | null;
    },
    resolveMedia: async () => null,
  };
}

interface PageData {
  content?: unknown;
  customCss?: string;
  editorMode?: string;
  body?: string;
}

export default async function SitePage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const nx = await getNextly({ config: nextlyConfig });

  // Look up the published page whose slug matches the URL.
  const { items } = await nx.find({
    collection: "pages",
    where: {
      slug: { equals: slug.join("/") },
      status: { equals: "published" },
    },
    limit: 1,
    richTextFormat: "html", // so "Normal" pages come back as ready-to-show HTML
  } as never);

  const page = items[0] as PageData | undefined;
  if (!page) notFound(); // no matching page -> 404

  // A page saved in "Normal" mode is plain rich text — just render its HTML.
  if (page.editorMode === "normal") {
    return <article dangerouslySetInnerHTML={{ __html: page.body ?? "" }} />;
  }

  // A page built with the visual builder -> hand its block tree to the renderer.
  if (!page.content) notFound();
  return (
    <PageRenderer
      document={page.content as never}
      customCss={page.customCss}
      dataProvider={makeDataProvider(nx)}
    />
  );
}
```

### 7.3 What this code does, in plain terms

1. It reads the URL (e.g. `/about` → slug `"about"`).
2. It asks Nextly for the **published** page with that slug.
3. If there isn't one, it shows a **404**.
4. If the page was made in **Normal** mode, it renders that page's rich-text HTML.
5. If the page was made in the **Page Builder**, it passes the saved blocks to
   `<PageRenderer>`, which turns them back into a real web page. Any custom CSS you
   set on the page is applied automatically.

You do **not** need extra `next.config` changes for this — the plugin is already in
`transpilePackages` from Step 2, and that covers the renderer too.

### 7.4 See it live

1. In the admin, open a page, give it a slug (e.g. `about`), and click **Publish**.
2. Visit it in the browser: `http://localhost:3000/about`.

Your built page is now served to the public. 🎉

> **Tip — a fixed landing page.** The catch-all above handles every slug. If you
> also want a specific route (say your homepage at `/`), create
> `src/app/(site)/page.tsx` with the same code but look up a fixed slug (e.g.
> `where: { slug: { equals: "home" } }`) instead of reading it from the URL.

---

## Troubleshooting

**Install fails with `ERESOLVE` / peer dependency error**
See the temporary note in Step 1 — install with `--legacy-peer-deps` for now.

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

**You see two "editor" controls (a toggle at the top _and_ an "Editor" dropdown in
the form)**
This is a known cosmetic duplication in the current release; the dropdown will be
hidden in an upcoming version. Use the top toggle — both do the same thing.

**Visiting your page URL shows a 404 (Step 7)**
Three things to check: (1) the page is **Published**, not just saved as a draft;
(2) the page's **slug** matches the URL you're visiting; (3) the `import
nextlyConfig from "../../.../nextly.config"` line has the right number of `../` to
reach your project's `nextly.config` file.

**Visiting your page URL shows a blank page**
The page probably has no blocks yet, or was saved empty. Open it in the builder,
add at least one block, and Publish again.

---

## Quick reference

```bash
# 1. Install
npm install @nextlyhq/plugin-page-builder        # add --legacy-peer-deps for now

# 2. next.config.ts  -> add plugin to transpilePackages (NOT serverExternalPackages)

# 3. nextly.config.ts -> plugins: [pageBuilder()]

# 4. Sync DB
npx nextly db:sync

# 5. Run
npm run dev

# 6. Open http://localhost:3000/admin  ->  Pages  ->  New Page  ->  "Page Builder"

# 7. Frontend: add src/app/(site)/[...slug]/page.tsx (see Step 7) to serve pages,
#    then visit http://localhost:3000/<your-page-slug>
```

Questions or something not working? Share the exact error from your terminal or
browser console and we'll sort it out.
