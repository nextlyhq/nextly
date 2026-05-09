# Seed Media Files

This directory holds the images the blog template's `seed-data.json` references. Everything here ships as lightweight SVG placeholders so a fresh scaffold looks intentional out of the box and is small in git. Replace them with real photography whenever you're ready.

## What's here

**Post cover images** (1600x900 viewBox SVG, ~1 KB each):

- `post-nextly-cms.svg`
- `post-server-components.svg`
- `post-typescript-tips.svg`
- `post-tailwind-guide.svg`
- `post-open-source.svg`
- `post-postgres-scale.svg`
- `post-testing-strategies.svg`
- `post-css-modern.svg`
- `post-seo-essentials.svg`
- `post-database-migrations.svg`
- `post-developer-experience.svg`
- `post-shipping-culture.svg`
- `post-design-systems.svg`
- `post-remote-work.svg`
- `post-async-writing.svg`
- `post-debugging.svg`

**Author avatars** (400x400 viewBox SVG, ~0.5 KB each):

- `author-jane.svg`
- `author-john.svg`
- `author-amelia.svg`

**Site logo**:

- `logo.svg`

Total on-disk size of the shipped placeholders is under 20 KB - they won't slow down a clone or balloon the published template tarball.

## Replacing with real photos

The shipped SVGs are intentionally visible placeholders (gradient background plus a title word). They communicate "this is where your cover image goes" without looking broken. Swap them for real images whenever you have assets.

### How the filename mapping works

`seed-data.json` references each image by filename in two places:

1. `posts[].featuredImage` - the filename (no path) of the post's cover.
2. `users[].avatarUrl` - the filename of the user's avatar.

When the seed runs, `nextly.seed.ts` looks for the file **locally first** under `seed/media/<filename>`. If it's absent, it falls back to `seedMedia.baseUrl` (see top of `seed-data.json`) plus the filename. So you have two drop-in replacement paths:

**Option A - Replace files in place (recommended for local work):**

1. Drop your replacement image in this directory with the same filename as the placeholder it replaces. JPEG, PNG, WebP, or AVIF all work; the seed detects MIME from extension.
2. If you want a different filename, update the matching `featuredImage` or `avatarUrl` entry in `seed-data.json`.
3. Re-run the seed. Media for existing posts won't re-upload (idempotent), so you'll want to also update the post's `featuredImage` in the admin, or reset the database and re-seed.

**Option B - Host elsewhere (recommended for shared templates):**

1. Upload your images somewhere publicly fetchable (S3, Cloudinary, your own CDN, GitHub raw).
2. Set `seedMedia.baseUrl` in `seed-data.json` to the directory URL that contains them.
3. Keep the filenames in `posts[].featuredImage` matching the files at that base URL.

## Recommended sources

- [Unsplash](https://unsplash.com) - free, no attribution required, high quality.
- [Pexels](https://pexels.com) - similar to Unsplash.
- Your own photography - nothing says "serious blog" like real photos of real things.

Once you have photos:

- Resize cover images to 1600x900 (or at least a 16:9 ratio) and JPEG at quality ~80. Aim for under 250 KB per file.
- Resize avatars to 400x400 and JPEG at quality ~85. Aim for under 50 KB per file.
- Optimize with [squoosh.app](https://squoosh.app) or `cwebp` / `avifenc` for AVIF. Both modern formats give 30-50% smaller files than JPEG at visually identical quality.

## If images go missing

The seed script handles missing images gracefully. Posts and authors will be created without images, and a warning gets logged during seed. You can always add or edit images via the admin panel after scaffolding.
