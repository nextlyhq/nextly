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

A node's provenance record is now checked on both roads into storage.

A document reaches storage two ways — an op through the edit vocabulary, and a
field write through the document validator — and only the op road checked
`origin`. So an import or a script could persist `{ from: "pattern", id: "",
digest: "" }`, and every later provenance reader would take it at face value: a
staleness check comparing against a pattern with no id answers confidently and
wrongly, and a save-over restoring the DOM ids an insert renamed reads a record
it cannot trust.

Both roads now ask the same published predicate, so a record one admits and the
other refuses — one that exists in the database and cannot be edited — is not
representable. It is an error in both validation modes: a half-written record is
not a value a future build understands, it is a claim about history with a piece
missing.

The check reads nothing the record computes for itself, and reflection failures
do not escape. A stored `origin` may be a caller-supplied object with accessors
or a Proxy whose own reflection traps throw; `surveyDocument` refuses to invoke
an accessor and already reports such a document unreadable, so the check defers
to that verdict rather than adding a second one about a record nothing can read.

It also reads only the fields the guard actually reaches, rather than every key
the record carries, so a document already refused by the byte cap cannot be made
to do work proportional to content the bounded survey never traversed.

`readBlockOrigin` is published beside `isBlockOrigin` and the guard is derived
from it. A caller that must tell a record it cannot READ from one that is merely
wrong — the validator does — would otherwise name the guard's fields a second
time, and two lists of the same thing drift silently.
