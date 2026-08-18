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

Leaving an entry editor with unsaved changes now asks first.

The admin ships an unsaved-changes guard — dialog, history interception,
back/forward handling, `beforeunload` — and nothing has ever mounted it. It has
been present since the first commit, exported through a barrel no consumer
imports, and touched since only by two theme passes that restyled a dialog which
never appeared. So navigating away from a half-written entry discarded it in
silence.

It is mounted now for the entry editor, and an action that has already asked the
question — Discard changes — says so rather than being asked it twice.

Not yet mounted for singles: an untouched single reports itself dirty on load,
so the guard would question a document nobody had edited. That is recorded as
its own defect rather than worked around here.
