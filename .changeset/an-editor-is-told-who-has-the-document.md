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

The claim is advisory throughout, and what follows from it is derived in one
place so the collection editor and the single editor cannot disagree.

- **Every write passes one gate.** Save, Publish, Unpublish, Delete, discarding a
  working draft, the keyboard shortcut, a native form submit and the quick-edit
  modal all reach the same handlers, so the refusal lives there. The controls are
  disabled as well, because nothing should offer what it cannot do, but disabling
  affordances one at a time is a list the next write path gets added without.
- **The title and the slug are writes too**, and the same claim withholds them.
  The title also drives the slug, so leaving it editable contradicted the strip
  above it.
- **Asking does not block editing.** Gating every document open on a round trip
  would cost every author on every open, to guard against a case that is rare,
  and a refusal loses nothing since the form is never cleared.
- **A failure to re-check a KNOWN claim does not unlock the document.** Every beat
  re-asks, so a transient rejection arrives long after a holder was reported;
  treating that as "free" hands the document to a second editor while the last
  confirmed fact is that a colleague holds an unexpired lease. Only a first check
  that never succeeded leaves the editor working.
- **A displaced editor keeps what they typed.** Their unsaved work stays on
  screen and stays theirs; what stops is writing.
- **Autosave keeps running**, which is the opposite of what it looks like it
  should do. `useDocumentAutosave` does not write the document: it upserts a
  recovery row keyed by document AND author that the live-row predicate excludes,
  so it cannot reach the holder's document or their recovery row. Stopping it
  would remove the displaced editor's safety net at the exact moment the banner
  promises their unsaved changes are still theirs, and the engine depends on it
  running.

The strip is where the lock is spoken. `DocumentStatusLive` is deliberately not
given a second copy: it exists so the header has one live region rather than one
per concern, and two in a view interrupt each other.
