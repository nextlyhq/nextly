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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

A class rename refused by a host is shown to the author only when the refusal
carries the reason the panel is about to print. The guard that recognised an
outcome read one field of it — whether `ok` was a boolean — and then narrowed
to a type promising `reason: string`, so any unrelated failure-shaped result a
host handed back was accepted as a refusal. `{ ok: false, error }`, which is
what an ordinary mutation helper answers with, reported `undefined`.

The notice renders on the reported reason not being `null`, and `undefined` is
not `null`, so the author got an error box with nothing written in it and a
screen reader announced an alert carrying no text — a rename declared failed
with no way to learn why. A result this cannot vouch for is silence again, as
it always was for a host that answers with nothing.
