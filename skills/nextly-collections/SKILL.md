---
name: nextly-collections
description: >-
  Use when defining or changing content types in a Nextly project in code:
  writing a collection with defineCollection, choosing field types, adding
  draft and published status, registering it in nextly.config.ts, generating
  TypeScript types, creating a migration, and reading entries from a Next.js
  Server Component with getNextly and find. Also use when a collection does
  not appear in the admin, a field change does not reach the database, or a
  page reading content fails to build.
metadata:
  nextly-version: 0.0.2-alpha.69
---

# Define a collection in Nextly

A collection is a content type with many entries: posts, products, authors.
Each one becomes a database table, an admin list and edit screen, and a type
you can query. Collections can also be made in the admin's visual Schema
Builder; this skill covers the code-first way.

Checked against `nextly` 0.0.2-alpha.67 with Next.js 16.4. Run
`npx nextly --version`; if it prints a newer version, prefer
<https://nextlyhq.com/docs> where it disagrees with this skill. Nextly must
already be installed (the `nextly-install` skill), with `esbuild` among the
dev dependencies.

## 1. Write the collection

`src/collections/posts.ts`:

```ts
import {
  defineCollection,
  text,
  textarea,
  richText,
  date,
  select,
} from "nextly/config";

export const Posts = defineCollection({
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [
    text({ name: "title", required: true }),
    text({ name: "slug", required: true, unique: true }),
    textarea({ name: "excerpt" }),
    richText({ name: "content" }),
    date({ name: "publishedAt" }),
    select({
      name: "category",
      options: [
        { label: "News", value: "news" },
        { label: "Guide", value: "guide" },
      ],
    }),
  ],
  // Draft and Published, with Save draft and Publish buttons in the admin.
  status: true,
  admin: { useAsTitle: "title" },
  access: {
    read: () => true,
    create: ({ user }) => Boolean(user),
    update: ({ user }) => Boolean(user),
    delete: ({ roles }) => roles.includes("admin"),
  },
});
```

Rules that matter:

- Import from `nextly/config` in collection files and in `nextly.config.ts`.
- Use **relative imports** in these files, never the `@/` alias. The Nextly
  CLI loads them with Node.js, which does not know Next.js aliases.
- `slug` is the table and API name: lowercase, stable. Renaming it later is a
  migration, not an edit.
- `id`, `createdAt` and `updatedAt` are added for you; do not declare them.
  Declare `title` and `slug` yourself, as above, or the admin shows no input
  for them and the slug is not unique. The admin fills an empty `slug` from
  the title.
- Field helpers in this release: `text`, `textarea`, `richText`, `email`,
  `password`, `code`, `number`, `checkbox`, `date`, `select`, `radio`,
  `chips`, `upload`, `relationship`, `repeater`, `array`, `group`, `json`.
  `relationship({ name: "author", relationTo: "users" })` links entries;
  add `hasMany: true` for several. `upload({ name: "image", relationTo: "media" })`
  links a media file.
- Access rules are explained in the `nextly-authentication` skill.

## 2. Register it

`nextly.config.ts`:

```ts
import { defineConfig } from "nextly/config";

import { Posts } from "./src/collections/posts";

export default defineConfig({
  collections: [Posts],
  singles: [],
  typescript: {
    outputFile: "./src/types/generated/nextly-types.ts",
  },
});
```

## 3. Apply it in development

Restart `next dev` after adding or changing a collection. The change is
applied to the development database on the first request after the restart:
the log says `Code-first sync completed`. On Next.js 16.4 the in-process
reload does not pick up a changed field without a restart.

Then open `/admin`: the collection is in the sidebar, with list and create
screens.

## 4. Generate types

```bash
npx nextly generate:types
```

This writes the file named in `typescript.outputFile`, and Zod schemas under
`src/db/schemas/collections/zod/` (`db/schemas/collections/zod/` without a
`src/` folder). With them, `find({ collection: "posts" })` is typed; without
them, entries are loosely typed and fields read as `unknown`. Regenerate in
the same change as every schema edit.

The Zod schemas import `z` from `nextly/zod`, so the project needs no `zod`
dependency of its own. To combine them with your own Zod code, import `z`
from `nextly/zod` there too.

## 5. Read entries in a page

Content is read on the server with the Direct API. Do not build an API route
to fetch your own content.

```tsx
// src/app/posts/page.tsx
import { getNextly } from "nextly";
import { cachedFind, nextlyTags } from "nextly/runtime";

import nextlyConfig from "../../../nextly.config";

async function getPublishedPosts() {
  return cachedFind(
    async () => {
      const nextly = await getNextly({ config: nextlyConfig });
      const { items } = await nextly.find({
        collection: "posts",
        status: "published",
        limit: 10,
      });
      return items;
    },
    { tags: nextlyTags("posts"), keyParts: ["posts", "list"] }
  );
}

export default async function PostsPage() {
  const posts = await getPublishedPosts();
  return (
    <ul>
      {posts.map(post => (
        <li key={String(post.id)}>{String(post.title)}</li>
      ))}
    </ul>
  );
}
```

- Without a `src/` folder the page is `app/posts/page.tsx`, importing
  `"../../nextly.config"`.
- `find()` returns `{ items, meta }`. `meta` holds the totals and pages.
- `status: "published"` keeps drafts off the page. Without it a trusted
  server read returns drafts too.
- `cachedFind` with `nextlyTags("posts")` caches the result and clears it when
  a post is saved, so the page updates on publish. It also lets the page build
  in an app with `cacheComponents: true`, where an uncached database read
  outside `<Suspense>` fails `next build`.
- `keyParts` names the cache entry, and everyone whose read uses the same key
  gets the same rows. Cache only reads that are the same for every reader:
  published content of a collection with no read rule, on the collection or
  on any of its fields. Do not cache a read that applies a reader's access
  rules (`overrideAccess: false` with a `user`): the reader's roles and
  permissions can change without any content changing, so no tag clears the
  entry. Read it uncached inside `<Suspense>` instead.
- Rich text comes back as Lexical JSON. Pass `richTextFormat: "html"` to
  `find()` to get HTML instead.
- Users are not a normal collection: read them with `nextly.users.find()`,
  which supports pagination and `search` but not `where`.

## 6. Make a migration before deploying

Development applies changes directly; production applies migration files.
When the change is ready to ship:

```bash
npx nextly migrate:create add_posts
```

This compares the config with the last migration's snapshot and writes
`src/db/migrations/<timestamp>_add_posts.sql` plus a snapshot under
`src/db/migrations/meta/`. Read the SQL, then commit both with the config
change. `npx nextly migrate` applies pending migrations; the `nextly-deploy`
skill runs it on every deploy. Once a migration is shared, never edit it: add
a new one.

## Check it worked

- The admin lists the collection and saves an entry.
- `npx nextly generate:types` succeeds and `npx tsc --noEmit` is clean.
- The page shows a published entry, and a draft does not appear.
- `next build` succeeds.
