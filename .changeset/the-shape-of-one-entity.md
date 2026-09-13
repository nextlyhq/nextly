---
"@nextlyhq/eslint-plugin": patch
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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

`get_collection_schema` and `get_single_schema`: the shape of one entity.

`get_initial_context` says which entities an agent can work with; these say what
one of them looks like. Split rather than folded into that answer for token
economy, since an install with forty collections would otherwise spend every
conversation's opening on thirty-nine schemas nobody asked for.

The schema comes from the registry through the services facade, not from a
description assembled in the plugin. Code-first collections are synced into the
same registry the Schema Builder writes to, so the registry is the merged view
of both and the type generator reads the same records. A tool reading the config
object instead would answer correctly for a code-first install, be blind to
every collection an operator built in the admin, and look right in both.

Authorization runs BEFORE the read, and has to. The registry read is not
access-controlled by design, because the registry is how the system describes
itself, so the gate in the tool is the only thing between a scoped key and the
shape of an entity it was never granted. The decision is core's own, the same
one that built the entity list, so the two tools cannot disagree about whether a
caller may see something.

A refusal does not separate "you may not read this" from "no such entity". A
caller able to tell those apart can map an install's slugs by asking about
guesses, which is disclosure by error message.

`canReadContent` is published from core beside `readableContent`, composed from
the same per-entity decision, and refuses an unregistered slug rather than
judging it. A slug with no registry entry has no rule to decide against, and
admitting what cannot be judged is the inversion the dashboard's readable
resources were fixed to remove.
