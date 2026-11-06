---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
"nextly": patch
---

**Breaking: image sizes are no longer made or offered.** An uploaded image is now stored as the original and one thumbnail, nothing more. The thumbnail is the whole image fitted inside 480×480, keeping its proportions and never enlarged, instead of a 300×300 centre crop. Moving an item's focus point saves the point and stores no new file.

What an app loses, and what to use instead:

- The sizes defined at **Settings › Image sizes** are no longer cut at upload or when the focus point moves. The screen, its menu entry and the `/admin/api/image-sizes` routes (list, get, create, update, delete, `regeneration-status`, `regenerate`) are removed; a request to one is answered as an unknown route (404).
- Media items no longer carry `sizes` in any API: REST, the Direct API (`MediaFile`), server actions, populated relationships and Singles, and `media.*` webhook payloads. The `Media` type `@nextlyhq/admin` exports loses `sizes`.
- Removed from `nextly`: `getMediaVariant`, `getSmallestMediaVariant`, `GetMediaVariantOptions` and `MediaLike`. Removed from `nextly/storage`: `generateImageSizes`, `deleteImageSizes`, `ImageSizeConfig`, `GenerateImageSizesOptions`, `UploadFn`, and `ImageProcessor.resizeWithFocalPoint`. Removed from `nextly/schemas` (and the root): the `imageSizes` table.
- Instead: give an item's `url` to `next/image`, which resizes it on request (a custom loader can send that to an image CDN); use `thumbnailUrl` for a small preview; and use `focalX` and `focalY` with `object-position` to keep the subject in frame.

Nothing stored is removed by this release. Items uploaded before it keep their `sizes`, their size files and their square thumbnail, and the `image_sizes` table and its rows stay; none of it is read. Deleting such an item still removes its size files.
