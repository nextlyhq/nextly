# Blog Template

A production-quality blog starter for Nextly. Ships with:

- 15 seeded posts · 3 authors · 4 categories · 8 tags
- Modern-tech visual design with full light/dark mode parity via a 3-state theme toggle
- Users-as-authors (no separate authors collection) with real admin/editor/author roles
- Homepage with admin-editable hero, featured post, latest grid, category strip, and newsletter CTA
- Post detail with reading progress bar, auto-TOC, share buttons, prev/next, and related posts
- Static search via Pagefind (zero server infrastructure)
- Newsletter signup via the `@revnixhq/plugin-form-builder` plugin
- Rich SEO: per-author / per-category / per-tag RSS, sitemap, OG images, JSON-LD (Article, Person, CollectionPage, BreadcrumbList, WebSite)

## What's Included

### Collections

- **Posts** - Title, slug, rich text content, featured image, author (relates to users), categories, tags, excerpt, publish date, featured flag, SEO group (metaTitle, metaDescription, ogImage, canonical, noindex), status (draft/published). Auto-generates slug from title; computes reading time and word count on save.
- **Categories** - Name, slug, description. Simple taxonomy.
- **Tags** - Name, slug, description. Granular cross-cutting taxonomy.

### Singles (globals)

- **Site Settings** - Site name, tagline, description, logo, social handles (Twitter, GitHub, LinkedIn). Drives the Header, Footer, and SEO metadata.
- **Navigation** - Header link list + footer "Read" link list + UI toggles (show theme toggle, show search icon).
- **Homepage** - Hero title/subtitle + section-visibility toggles (featured post, latest grid, category strip, newsletter CTA) + newsletter heading/subheading.

### Users as authors

The template uses the built-in `users` collection as the author identity: posts relate directly to users via the `author` relationship field. Each user has additional scalar fields defined in `configs/codefirst.config.ts`:

- `bio` (textarea): short author bio shown on post footers and `/authors/[slug]`.
- `avatarUrl` (text): URL of an avatar image. Plain text (not an uploaded media record) because user-extension fields support only scalar types today.
- `slug` (text): URL slug for `/authors/[slug]`. Unique per user.

No separate `authors` collection; no duplicated profile data.

### Roles

Three roles seeded on first run:

- **Administrator** (`admin`) - full access to content, taxonomy, media, and users.
- **Editor** (`editor`) - create, edit, and publish any post; manages categories, tags, and media.
- **Author** (`author`) - draft and edit their own posts; read published content.

Fine-grained permissions are not pre-assigned by the template. The three roles exist as labeled buckets; configure their permission rules via `/admin/roles/<slug>` or programmatically with `nextly.roles.setPermissions({...})`. The `super-admin` role (seeded by Nextly core) bypasses all access checks.

Collection access policies in `src/access/` gate who can reach each CRUD operation:

- Posts: public can read; any logged-in user can create a draft; `admin`/`editor`/`author` can update or delete.
- Categories and Tags: public can read; `admin`/`editor`/`author` can edit.

Row-level checks (authors only editing their own posts) live at the database permission layer, not in the access functions - the `AccessControlFunction` signature doesn't receive the target document.

## Pages

| Route                         | What it is                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `/`                           | Homepage: hero + featured + latest grid + category strip + newsletter CTA (all toggleable from the Homepage single) |
| `/blog`                       | All posts, paginated 9 per page                                                                                     |
| `/blog/[slug]`                | Post detail with reading progress, auto-TOC, share bar, author card, related posts, prev/next                       |
| `/authors/[slug]`             | Profile-centered author page with big avatar, bio, stats, post grid                                                 |
| `/categories`                 | All categories as a card grid with descriptions + post counts                                                       |
| `/categories/[slug]`          | Category archive, paginated, per-category RSS link                                                                  |
| `/tags`                       | Tag cloud sized by post count                                                                                       |
| `/tags/[slug]`                | Tag archive, paginated, per-tag RSS link                                                                            |
| `/search`                     | Client-side Pagefind search                                                                                         |
| `/feed.xml`                   | Site-wide RSS feed                                                                                                  |
| `/categories/[slug]/feed.xml` | Per-category RSS                                                                                                    |
| `/tags/[slug]/feed.xml`       | Per-tag RSS                                                                                                         |
| `/authors/[slug]/feed.xml`    | Per-author RSS                                                                                                      |
| `/sitemap.xml`                | Sitemap covering posts, categories, tags, authors, and static pages                                                 |

### Design system

Light and dark modes are driven by CSS custom properties in `src/app/globals.css`. The theme toggle in the header cycles Light / System / Dark and persists to `localStorage`. First paint has the correct theme applied via an inline script in `<head>` (no flash-of-wrong-theme).

Typography lives under `.prose-blog` for the rich-text renderer; tokens adjust across themes automatically.

## Schema approaches

The template supports all three Nextly schema approaches:

- **Code-first** (`configs/codefirst.config.ts`) - Full schemas in TypeScript. Best for version control and type safety.
- **Visual** (`configs/visual.config.ts`) - Empty config. Create schemas via the Admin Panel.
- **Both** (`configs/both.config.ts`) - Core schemas in code, extendable via the UI.

## Customization

### Hero, homepage sections, navigation - edit from the admin

Go to `/admin/singles/homepage` and change the hero title, subtitle, or newsletter copy. Toggle sections on/off with the checkboxes. Same for Site Settings and Navigation - all three singles ship with sensible defaults but are editable without touching code.

### Theme colors

Edit CSS variables in `src/app/globals.css`:

- Light values under `[data-theme="light"]`
- Dark values under `[data-theme="dark"]`
- `--color-accent` is the single accent color used for links, the reading progress bar, focus rings, and newsletter buttons

### Photos

Replace the placeholder gradient SVGs in `seed/media/`. See `seed/media/README.md` for a full guide on sizing, format, and where to source photography.

### Adding fields to posts

Edit `src/collections/Posts/index.ts`:

```typescript
// src/collections/Posts/index.ts
fields: [
  // ...existing fields...
  checkbox({ name: "pinned", defaultValue: false }),
  text({ name: "subtitle" }),
],
```

Re-run `pnpm dev`. The schema-change handler walks you through applying the migration.

### Adding pages

Create new files in `src/app/(frontend)/` following the Next.js App Router conventions. The `(frontend)` route group provides the Header and Footer via `layout.tsx`.

## Performance

Dynamic pages pre-render at build time via `generateStaticParams` and revalidate every 60 seconds (ISR):

- Every published post
- Every author
- Every category
- Every tag

New content renders on-demand and caches until the next ISR tick. Adjust the window by editing `export const revalidate = 60` in the relevant page. Lower for fresher content at higher DB cost; higher for the opposite.

Images use `next/image` with a `sizes` attribute so phones don't download desktop-sized files. The `unoptimized` prop is set on avatar images since they can come from arbitrary remote URLs that aren't in `next.config.images.remotePatterns`.

## Data fetching

All pages fetch data using Nextly's Direct API:

```typescript
import { getNextly } from "@revnixhq/nextly";

export default async function BlogPage() {
  const nextly = await getNextly();
  // Returns ListResult<T> = { items, meta }.
  const result = await nextly.find({
    collection: "posts",
    where: { status: { equals: "published" } },
    sort: "-publishedAt",
    limit: 9,
    depth: 2,
  });
  result.items; // Post[]
  result.meta.total; // number
  // render result.items...
}
```

The Direct API runs in Server Components with zero HTTP overhead. Relationships populate via the `depth` parameter. Per-request caching (React `cache()`) avoids duplicate fetches when multiple components need the same data; see `src/lib/queries/` for the cached helpers.

## Search

Search uses [Pagefind](https://pagefind.app), a static search index:

1. `pnpm build` compiles Next.js and runs `scripts/build-search-index.mjs`, which scans the rendered HTML and writes an index under `public/pagefind/`.
2. The `/search` page loads `pagefind.js` on demand and runs queries entirely in the browser.
3. No server-side search infrastructure required.

To rebuild the index manually without a full site build: `pnpm search:index`.

On platforms other than Vercel, set a `Content-Type: application/wasm` header for `public/pagefind/*.wasm` or Pagefind's MIME check may fail.

## Newsletter

The homepage and footer newsletter forms submit to the `@revnixhq/plugin-form-builder` plugin. Submissions are stored in the `form-submissions` collection and visible at `/admin/collections/form-submissions`.

The seed creates a form with slug `newsletter` on first run. If the seed skipped it (or you removed it), create a new Form at `/admin/collections/forms` with slug `newsletter` and the plugin + frontend will start working.

To send a welcome email on subscription, add an `afterChange` hook on the `form-submissions` collection that calls your email provider when the referenced form's slug is `newsletter`.

## SEO

- **Metadata API**: every page defines `generateMetadata` with title, description, canonical, Open Graph, and Twitter card. Per-post SEO fields (metaTitle, metaDescription, ogImage, canonical, noindex) override the defaults.
- **JSON-LD**: post detail ships Article + BreadcrumbList, category/tag archives ship CollectionPage + BreadcrumbList, author pages ship Person + BreadcrumbList, homepage ships WebSite.
- **Sitemap**: auto-generated at `/sitemap.xml` from published content.
- **OG images**: dynamic per-post OG at `/blog/[slug]/opengraph-image` (and similar for categories, tags, authors) - Vercel's `@vercel/og` with Next.js conventions. Uploaded per-post `seo.ogImage` takes precedence when set.
- **RSS**: four feeds - site-wide, per-category, per-tag, per-author. All include the last 20 published posts with title, link, description, and pubDate.

## File layout

```
templates/blog/
  configs/
    codefirst.config.ts    # Code-first schemas + plugins
    both.config.ts         # Code-first + UI extensions
    visual.config.ts       # Empty; UI-created schemas only
  seed/
    media/                 # Gradient SVG placeholders (see README there)
    seed-data.json         # 15 posts + 3 users + 4 categories + 8 tags
    nextly.seed.ts         # Idempotent seed script (users, roles, content, forms)
  scripts/
    build-search-index.mjs # Pagefind index generator
  src/
    access/                # RBAC access-control functions
    actions/               # Server Actions (newsletter submission)
    app/
      layout.tsx           # Root layout with theme-init script
      globals.css          # Design tokens + .prose-blog
      sitemap.ts
      robots.ts
      feed.xml/            # Site-wide RSS
      opengraph-image.tsx  # Default OG image
      (frontend)/          # Route group for the public-facing blog
      categories/[slug]/feed.xml/
      tags/[slug]/feed.xml/
      authors/[slug]/feed.xml/
    collections/
      Posts/               # Folder collection with its own hooks
      Categories.ts        # Flat (trivial collection)
      Tags.ts              # Flat (trivial collection)
    globals/
      SiteSettings/
      Navigation/
      Homepage/
    hooks/
      auto-slug.ts         # Shared beforeValidate hook (Posts + Categories + Tags)
    lib/
      extract-toc.ts       # HTML -> TOC utility for post detail
      queries/             # Cached Direct-API wrappers
      rss.ts               # Minimal RSS 2.0 builder
      site-url.ts
    components/            # React components (26 total)
```

The architecture follows Payload CMS's hybrid pattern: folder-per-collection-when-complex, flat-file-when-trivial. Hooks used by multiple collections live in `src/hooks/`; collection-specific hooks live inside that collection's folder.

## Known limitations

These are tracked as follow-ups in `findings/task-17-*.md` in the Nextly integrations workspace:

- On the very first `pnpm dev`, physical tables for the three Singles (site-settings, navigation, homepage) may be created AFTER the user seed runs. The seed's `updateGlobal` calls are wrapped in try/catch and log a warning; the admin panel lets you edit the singles after scaffolding. Subsequent dev restarts work correctly.
- The `nextly.find({ collection: "users", ... })` generic path routes through the dynamic-collection registry; the template uses `nextly.users.findOne` instead.
- `nextly.roles.create` may return an opaque error on some installs; the seed skips gracefully and you can create roles manually at `/admin/roles`.

## Extending

This template is intended as a starting point. Common customizations:

- **Change the aesthetic**: edit CSS tokens in `globals.css` and swap the `Geist` font in `src/app/layout.tsx` for your choice.
- **Replace the newsletter provider**: the `submit-newsletter.ts` Server Action can call any HTTP endpoint. Swap the `form-submissions.create` body for a Resend / ConvertKit / Mailchimp API call if you'd rather bypass the Nextly admin.
- **Add comments**: drop in Giscus (GitHub Discussions) or Commento. Comments aren't shipped by default because they're spam magnets and rarely used on modern tech blogs - but the template stays out of the way if you add them.
- **Scheduled publishing**: add a `publishAt` date field + a cron job that flips `status: "scheduled"` to `status: "published"` when the date passes. The template doesn't ship this because it needs a job runner (Vercel Cron, BullMQ, etc.) - your infra, your choice.
