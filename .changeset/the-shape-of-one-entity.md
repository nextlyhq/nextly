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

Review round two, and most of it was mine to fix.

`get_single_schema` read the singles facade's result as `items` when it answers
with `data`, so every successful call threw. A locally redeclared interface hid
the mismatch, and no test caught it because every single case exercised the
REFUSAL path, which returns before the registry is read. Both tools now import
the facade's own types, and a case drives a real single's schema end to end.

Removing that redeclared interface exposed two more things it had been hiding: a
read that passed a user context built from `ctx.user` alone, which carries no
roles and no key scope, and a context parameter that is documented as unused.
The registry read is not access-controlled and the authorization that matters
already happened above it, so it now passes an empty context rather than a
fabricated identity that would imply the call is gated by it.

Both tools serve clients that read only `content`. A client on a 2025 revision
does not understand structured output, and the protocol library appends a text
rendering only when `structuredContent` is a non-object value, so an
object-shaped result reached those clients as a success with an empty body.
`get_initial_context` had the same defect and now carries its data as a second
block, after the instructions block, which stays a constant.

The kind is checked in both directions. A single's slug through the collection
tool used to surface a registry not-found instead of the uniform refusal, which
is a difference an unauthorized caller can measure.

A container field's children survive the projection, and type-specific
declaration travels with it, so a group or repeater no longer arrives as a field
of no particular shape.

`readableContentKind` answers the access question and the kind question
together, and `canReadContent` is derived from it rather than asking separately.

The stability ledger now lists these exports. It did not list `readableContent`
or `routePathIsLiteral` either, both already published, and that ledger treats
every unlisted export as internal, so three public APIs carried contradictory
guarantees.

Review round three, and the first two were consequences of the round-two fix
that started forwarding type-specific declaration.

`options` is not one shape. A `select` or `radio` field declares an ARRAY of
label/value pairs, while the legacy registry definition uses the same key for an
object bag carrying a number's format or a relation's target. The output schema
admitted only the object, and the server validates a tool result against it, so
forwarding a select field's options converted an otherwise successful lookup
into a validation failure. Both shapes are admitted now.

A relationship's `relationTo` and `hasMany` are top-level members, not entries
in that bag, so a projection copying only the bag returned a relationship's name
and type and nothing a client could act on: whether the value is one id, an
array of ids, or a polymorphic reference is decided by exactly those two.

`get_single_schema` now asks the registry for the one slug it wants, through the
slug allowlist the list options already carry, rather than listing every Single
and searching in memory. The registry deserializes each record it returns, so
the unfiltered form materialized the whole registry to answer about one.
