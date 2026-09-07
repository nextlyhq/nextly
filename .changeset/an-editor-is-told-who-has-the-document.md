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

An editor is now told when a colleague is already in the document they opened,
and can read it or take it over.

A strip above the document names the holder, and the fields below it render
uneditable while somebody else has it. Both are needed: rendered read-only the
fields are legible but ambiguous, since a tinted uneditable form reads equally as
a document this account lacks permission to change.

The claim is advisory throughout, and the four decisions that follow from it are
derived in one place so the collection editor and the single editor cannot
disagree about them.

- **Asking does not block editing.** Gating every document open on a round trip
  would cost every author on every open, to guard against a case that is rare,
  and a refusal loses nothing since the form is never cleared.
- **A lock that cannot be checked does not stop work.** The claim exists to tell
  two people about each other, not to be a permission, so a server that cannot be
  reached leaves the editor working with a note rather than an outage.
- **A displaced editor keeps what they typed.** Their unsaved work stays on
  screen and stays theirs; what stops is writing, until they take the document
  back.
- **Autosave stops wherever saving stops.** A recovery point is a write to the
  same row, so leaving it running under someone else's claim is the overwrite the
  feature exists to prevent, made quieter by happening on a timer nobody watches.

The strip is where the lock is spoken. `DocumentStatusLive` is deliberately not
given a second copy: it exists so the header has one live region rather than one
per concern, and two in a view interrupt each other.
