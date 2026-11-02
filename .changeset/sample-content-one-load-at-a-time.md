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

Sample content on the setup card loads at most once at a time for the whole site, and every outcome stays on the card until the person has seen it.

- **One load at a time.** The project's sample-content route hands its load to Nextly's runner (`sampleContentPost` from `nextly/database/seeders`), which claims the site's one load in `nextly_meta` before loading anything. A start while another load is unfinished, after somebody loaded or declined, or after a failed load without `{ "confirm": true }` is refused with 409 and loads nothing, on every dialect. No new table: the latest load or decline is one `seed.current` row, claimed by one conditional write (inserted only where none exists, then moved only from the failed load it was read as), so every read of the site's answer is three rows however many loads were tried; `seed.run.<n>` keeps a copy of the last three, and `seed.completedAt` and `seed.skippedAt` keep their meaning. The route answers a load as `{ message, item }` and a refusal or failure in the standard error envelope, with `data.reason`; its confirmation body is read through the bounded byte reader.
- **Offered only to someone who can load it.** "Load sample content" is offered only when the route's probe answers 2xx for this person, only while the site holds no entry and nobody has answered. When the site's answer cannot be read, the card offers no load and shows "Add your first entry". The card asks for the site's current answer whenever the dashboard regains focus, and after every answer from the server.
- **Every outcome stays.** A probe that fails or refuses withholds only the offer, never a load the site started, so setup never retires over one. A load's progress and outcome survive the card being drawn again, customise mode included. A load that never reported says "A load started at <time> has not finished" and starts nothing else, however long ago it started. A failed load says what failed, with "Add your first entry", and Try again (while the site holds no entry) warns that some content may already be there and loads again only once confirmed. A load whose record failed says exactly that, and its Try again records it without loading again. A check of the other steps that fails while a run is on show is said beside it, with its own Retry. Continue shows the steps as they are now.
- **Declining and recording are Nextly's.** `PUT /api/dashboard/setup` takes `sample: "decline"` and `sample: { record }` (internal to the admin), so neither reaches a route that loads. The blog template's `/admin/api/meta/seed-status` declines through the same runner and no longer writes `seed.completedAt`; `GET` also answers the site's answer and its load. Nothing is retried on its own.
- **Inside the admin** (none of it published), the `useSeedStatus` hook and `seedApi.runSeed`, `getStatus` and `setSkipped` are replaced by `seedApi.start` and the setup card's own data. A project route older than the runner still loads, as before, without the single-load guarantee: copy the blog template's two routes to get it.
