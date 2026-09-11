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

The Save as pattern verb now asks whether the author may create a pattern, and
says so when they may not.

A role that can update pages but lacks the separately seeded `create` grant on
the patterns collection was offered the verb on the toolbar, the context menu
and the command palette. The author filled in the form and the save was refused
— legibly, and after the work.

Only the server can answer this. The grant is held against the RESOLVED
collection, a site may have renamed it, and the browser knows the declared name
alone; gating on that would refuse an author who holds the grant, hiding a
feature that works. So the plugin contributes a small authenticated route that
asks the framework's own `ctx.caller.can`, and the editor reads it once on
mount, before any of the three surfaces draws.

The verb is DISABLED WITH A REASON rather than hidden, matching every other
refusal on that toolbar, and it stays offered while the answer is in flight: a
wrong "yes" costs the late refusal that already happened, while a wrong "no"
hides a feature the author holds and nothing on the canvas would explain it.

Not a security boundary. The write authorizes itself, exactly as before.
