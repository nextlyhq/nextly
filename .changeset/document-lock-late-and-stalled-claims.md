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

Close five ways a document claim could report one thing while the server held
another, and widen the reader the client-bundle boundary depends on.

**A claim is credited from when it was sent, not when the reply arrived.** The
lease starts when the server processes a claim, so timing it from receipt credits
the editor with however long the reply spent in transit. A reply delayed past the
margin left the hook reporting a claim that had already expired server-side,
while a colleague could take the row.

**A request that never settles is now bounded.** Nothing cleared the
one-at-a-time slot for a pending request, so every later beat returned at the
serialisation guard and the editor sat in `acquiring` for the whole session with
a take-over queued behind a request that was never coming back. Claims carry an
abort signal bounded by one heartbeat.

**A failed poll forgets the holder it had cached.** A colleague renewing on the
same cadence reports identical fields, so the quiet-poll comparison suppressed
the update and stranded the editor on `unavailable` while the server was
answering perfectly well.

**A late reply from a replaced effect run repairs what it broke.** The server
treats a claim from the same owner as takeable, so a request still in flight when
its effect was cleaned up displaced the run that replaced it. Handing that claim
back left the live run holding a token the server had already forgotten. The run
that got displaced is now told to claim again.

**`module.require` counts as loading a module.** It is the documented CommonJS
method and resolves exactly as the free function does, so
`@nextlyhq/module-specifiers` reported a file loading nothing while it loaded a
driver, and the client-bundle boundary that reads it would have certified such a
graph as clean. `loader.require` still does not count: it is a method on somebody
else's object.
