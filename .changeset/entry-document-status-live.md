---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

feat(admin): announce document status in one polite region

The entry editor reported whether an author's work was stored visually only.
`AutoSaveIndicator` cycles through "Saving…", "Saved", "Unsaved changes" and
"Not saved", and the header carried no live region at all — so the control
whose whole purpose is reassuring someone their work is safe did that for
sighted users only.

The header now has a single `role="status"` / `aria-live="polite"` region
covering document status. One region rather than one per concern: two live
regions in the same header interrupt each other, and a reader cannot tell which
announcement belongs to what they just did.

Two deliberate choices. The transient "saving" state is silent, because autosave
debounces and announcing it speaks over the reader every few seconds while they
type — what matters is where the state came to rest. And the spoken wording is a
full sentence ("Your work is stored") rather than the chip's terse label, since
an announcement arrives with no visual context to tell the listener what the
word refers to.

The region also accepts translation progress, so a multilingual entry can report
both kinds of document state through the same channel.
