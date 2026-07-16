---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Require authentication and permissions to write media.

Media writes are no longer open. Previously anyone on the internet could upload, edit, move, or delete a site's media by calling `/api/media` with no login and no key — the endpoint had no auth at all. Now the write operations (upload, update, move, delete, and their folder equivalents) live at a gated **`/admin/api/media`**, where each is checked against a media permission (`create`/`read`/`update`/`delete-media`) and the acting user is taken from the authenticated session or API key, never from a request field like `uploadedBy` (which could name anyone). Reading media stays public at `/api/media` — files are served to anonymous visitors — but that path now serves **reads only**; its write verbs are gone.

This is why media permissions could not previously gate anything: the admin's session cookie is scoped to `/admin`, so it never reached `/api/media`, and the whole `manage`/`create`/`read`/`delete-media` set was decorative. Moving the management surface under `/admin` is what lets the session authenticate, so the permission checks finally take effect.

Also adds a real **`update-media`** permission (media had create/read/delete but no update), so editing metadata and moving files gates on `update-media` consistently with every other resource. The built-in Admin, Editor, and Author roles pick it up automatically; Viewer does not.

**Consumer action:** if your app re-exports the media handlers, mount the gated instance for the admin — `createMediaHandlers({ config, requireAuth: true })` at `app/admin/api/media/[[...path]]/route.ts` — and keep the public read-only instance (`createMediaHandlers({ config })`, exporting `GET` only) at `app/api/media/[[...path]]/route.ts`. Media file URLs in API responses are unchanged and remain public (no `/admin` prefix).
