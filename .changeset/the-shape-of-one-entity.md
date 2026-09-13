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

Review round four, and the same finding shape arrived for the third time, so
this round changes the design rather than adding another member to it.

Rounds two, three and four each reported that the field projection had dropped a
declaration key: a select's options, then a relationship's target and
cardinality, then the slugs a component field points at. A projection written as
a list of member names cannot notice a name missing from it, and three people
reading carefully is not a control. A fourth key was missing and nobody reported
it at all: the Schema Builder writes a select's choices as `fieldOptions` where
code-first writes `options`, so every Builder-authored select answered with no
choices while each code-first fixture looked correct.

`declaredShape` is now the one projection every surface uses to describe a
field, and which keys it publishes is data rather than control flow. Core
classifies each key as describing the field's value or as withheld, and a test
holds that classification TOTAL against the manifest field schema that every
stored declaration is validated against. A key added there and classified
nowhere fails the build on the commit that adds it, which is the only place
somebody knows the answer. The allowlist direction is deliberate: a denylist
cannot lose a key, but it publishes an unclassified one to a caller holding a
narrowly scoped credential the day it is written, and losing a key is a defect
somebody reports while disclosing one is not.

The Singles facade published `name`, `type` and nested `fields` and nothing
else, so no Single could answer with a select's choices or a relationship's
target however the tool projected them. It now reduces records through the same
projection, which fixes every consumer of `ctx.services.singles` rather than
this tool alone.

A relationship's target is now authorized before it travels. A schema names
other entities from inside itself, so forwarding the target of a field pointing
at a collection the caller was refused tells them it exists, which is the
enumeration the uniform refusal exists to prevent reached from another
direction. A polymorphic target keeps the arms the caller may read and drops the
rest, and the key goes entirely when none survive rather than staying as an
empty array.

Redaction asks whether a target is WITHHELD, not whether it is unreadable, and
the difference was measured rather than assumed. `users`, `media`, `roles` and
`permissions` are in neither content registry, so a rule keyed on readability
alone strips the target from every upload field and every relationship to a
system entity, for a super administrator included. `contentReadability` reports
the registry fact and the access fact together so the two cases can be told
apart, and `readableContentKind` is derived from it rather than asking again.

`readableContentKind` takes a point lookup where it took a full enumeration of
both registries. An agent inspecting the entities `get_initial_context` listed
was scanning every registry row once per entity, which is the whole registry
read N times to answer N questions that each name one slug.
