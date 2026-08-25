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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The Preview action in the entry editor is now wired to something. `useEntryPreview` answers
whether a collection previews and where, and nothing called it — so the two props
`PreviewActions` needs arrived as their defaults and the control could only ever draw its
copy-link half. Every layer existed and none of them were joined, which is why the button was
absent rather than broken.

It opens the SAVED draft, and the machinery that claimed otherwise is gone. The admin used to
write the editor's unsaved form values into session storage and append `?_preview=<key>` to the
URL, and nothing anywhere ever read that key back: the site renders the draft route on the
server, so the values it shows are the ones the server read. Carrying browser-held values into
that render would mean the page displaying content that never passed the field-level read rules
the draft route applies, which is the trust boundary the preview work has just spent eight pull
requests establishing. The address is resolved from the saved row for the same reason — resolving
it from an unsaved slug names a page that does not exist yet.

The preview is therefore offered only once an entry has been saved, and its reasons for declining
now reach the editor as messages that say what to do about them.
