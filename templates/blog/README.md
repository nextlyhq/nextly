# Blog Template

A complete blog starter with posts, authors, categories, and a clean frontend built with Server Components and Tailwind CSS.

## What's Included

### Collections

- **Posts** - Title, slug, rich text content, featured image, author (relates to users), categories, tags, excerpt, publish date, featured flag, SEO group, status (draft/published). Auto-generates slug from title; computes reading time and word count on save.
- **Categories** - Name, slug, description. Simple taxonomy for organizing posts.
- **Tags** - Name, slug, description. Granular cross-cutting taxonomy.

### Users as authors

The template uses the built-in `users` collection as the author identity: posts relate directly to users via the `author` relationship field. Each user has additional scalar fields defined in `configs/codefirst.config.ts`:

- `bio` (textarea): short author bio shown on post footers and `/authors/[slug]`.
- `avatarUrl` (text): URL of an avatar image. Plain text (not an uploaded media record) because user-extension fields support only scalar types today. Full URL or a filename served from your seed-media base URL.
- `slug` (text): the URL slug for `/authors/[slug]`. Unique per user.

No separate `authors` collection; no duplicated profile data.

### Roles

Three roles seeded by the template on first run:

- **Administrator** (`admin`) - full access to content, taxonomy, media, and users.
- **Editor** (`editor`) - can create, edit, and publish any post; manages categories, tags, and media.
- **Author** (`author`) - can draft and edit their own posts; reads published content.

Fine-grained permissions are not pre-assigned by the template. The three roles exist as labeled buckets; configure their permission rules via `/admin/roles/<slug>` or programmatically with `nextly.roles.setPermissions({...})`. The `super-admin` role (seeded by Nextly core) bypasses all access checks.

Collection access policies in `src/access/` gate who can reach each CRUD operation:

- Posts: public can read; any logged-in user can create a draft; `admin`/`editor`/`author` can update or delete.
- Categories and Tags: public can read; `admin`/`editor`/`author` can edit.

Row-level checks (authors only editing their own posts) live at the database permission layer, not in the access functions - the `AccessControlFunction` signature doesn't receive the target document.

### Singles

- **Site Settings** - Site name, tagline, description, logo, social links (Twitter, GitHub, LinkedIn). Used by the Header and Footer components.

### Frontend Pages

All pages are Server Components using Nextly's Direct API (zero HTTP overhead).

| Route                | Page             | Description                                                      |
| -------------------- | ---------------- | ---------------------------------------------------------------- |
| `/`                  | Homepage         | Hero section with site name/tagline + latest 3 posts             |
| `/blog`              | Blog Listing     | All published posts in a grid with pagination (9 per page)       |
| `/blog/[slug]`       | Single Post      | Full post with rich text, author card, categories, related posts |
| `/authors/[slug]`    | Author Profile   | Author bio + all their published posts                           |
| `/categories/[slug]` | Category Archive | Posts filtered by category with pagination                       |

### Components

| Component        | Purpose                                                      |
| ---------------- | ------------------------------------------------------------ |
| Header           | Site name and navigation                                     |
| Footer           | Copyright, social links, "Powered by Nextly"                 |
| PostCard         | Post preview card with image, title, excerpt, metadata       |
| PostGrid         | Responsive grid layout (1/2/3 columns)                       |
| Pagination       | URL-based page navigation (?page=N)                          |
| AuthorCard       | Author avatar, name, bio (compact and full variants)         |
| CategoryBadge    | Linked category pill                                         |
| RichTextRenderer | Renders Lexical rich text as HTML with Tailwind prose styles |

### Seed Data (optional)

When demo content is selected, the seed system creates:

- 5 blog posts about web development topics
- 2 authors (Jane Smith, John Doe)
- 3 categories (Technology, Tutorials, Opinion)
- Site settings with name, tagline, and social links
- Placeholder images for posts and author avatars

Demo content is seeded automatically on first `pnpm dev`.

## Schema Approaches

This template supports all three approaches:

**Code-first** (`configs/codefirst.config.ts`): Full schema definitions in TypeScript. Best for developers who want type safety and version control.

**Visual** (`configs/visual.config.ts`): Empty config. Schemas are created by the seed script or manually via the Admin Panel.

**Both** (`configs/both.config.ts`): Core schemas in code with the ability to add more via the Admin Panel.

## Customization

### Adding fields to posts

Edit `nextly.config.ts` and add fields to the posts collection:

```typescript
const posts = defineCollection({
  slug: "posts",
  fields: [
    // ...existing fields...
    checkbox({ name: "featured", defaultValue: false }),
    text({ name: "metaTitle" }),
    textarea({ name: "metaDescription" }),
  ],
});
```

### Changing the design

All components use Tailwind CSS utility classes. Edit the component files in `src/components/` to change colors, spacing, typography, or layout.

### Adding pages

Create new files in `src/app/(frontend)/` following the Next.js App Router conventions. The `(frontend)` route group provides the Header/Footer layout automatically.

### Adding image blur placeholders (optional)

`next/image` loads images without a blur-in effect by default. To add blurred placeholders that fade into the final image, install `plaiceholder`:

```bash
pnpm add plaiceholder sharp
```

Then generate a blur data URL at render time and pass it to the Image component:

```tsx
import { getPlaiceholder } from "plaiceholder";

async function getBlur(url: string) {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const { base64 } = await getPlaiceholder(buf);
  return base64;
}

const blurDataURL = featuredImage?.url
  ? await getBlur(featuredImage.url)
  : undefined;

<Image
  src={featuredImage.url}
  placeholder={blurDataURL ? "blur" : "empty"}
  blurDataURL={blurDataURL}
  // ...rest of props
/>;
```

For production, cache the result (e.g. via React `cache()` or a persistent key-value store) so plaiceholder only runs once per image.

## Performance

The template pre-renders every dynamic page at build time via `generateStaticParams`:

- Every published post
- Every author
- Every category
- Every tag

New content gets rendered on-demand and cached (`revalidate = 60` — 60-second ISR window). This gives you static-site speed with CMS flexibility.

- **Tuning the staleness window**: edit `export const revalidate = 60` in the page file. Lower for fresher content at higher DB cost; higher for the opposite.
- **Pre-render cap**: each dynamic route pre-generates up to 1000 entries at build time. Beyond that, posts/authors/categories/tags still render on-demand via ISR — they just miss the build-time boost.

`<Image>` components include a `sizes` attribute so responsive images are served at the right width per breakpoint (phones don't download desktop-sized images).

## Data Fetching

All pages fetch data using Nextly's Direct API:

```typescript
import { getNextly } from "@revnixhq/nextly";

export default async function BlogPage() {
  const nextly = getNextly();
  const result = await nextly.find({
    collection: "posts",
    where: { status: { equals: "published" } },
    sort: "-publishedAt",
    limit: 9,
    depth: 2,
  });
  // render posts...
}
```

The Direct API runs in Server Components with zero HTTP overhead. Relationships are populated via the `depth` parameter.
