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

A production server (`next build` and `next start`) now serves a file uploaded to Nextly's default local-disk storage as soon as the upload finishes, at the same `/uploads/...` URL `next dev` gives it. Before, Next.js answered 404 for it until the server restarted, because `next start` serves only the files `public/` held when it started. A route at `src/app/uploads/[...path]/route.ts`, built on the new `nextly/api/uploads` export, serves the rest: it streams files, answers `Range` requests for video and audio, sends `ETag` and caching headers, sets `nosniff` and a script-blocking policy on SVGs, and answers 404 for any path outside the storage folder and whenever cloud storage holds media. The local adapter's check that a path stays inside its folder no longer accepts a sibling folder whose name starts with the folder's own, such as `public/uploads-private` beside `public/uploads`.

**Before you upgrade:** projects don't ship the uploads route yet, so an app keeps the old behaviour until it has one. Add `src/app/uploads/[...path]/route.ts` (or `app/uploads/[...path]/route.ts` without a `src/` folder) exporting `GET` and `HEAD` from `createUploadsHandlers({ config })` in `nextly/api/uploads`, as shown in [Media & Storage](https://nextlyhq.com/docs/guides/media-storage#how-local-uploads-are-served). Until then, a production server logs a warning naming the file the first time an upload would be unreachable.
