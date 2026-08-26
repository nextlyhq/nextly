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

A Single's preview pane is now called by the name the Single declares, instead
of always saying "Preview". A collection's preview has always honoured
`admin.preview.label`; a Single's ignored it.

The server was already sending it. A preview declaration's `url` is a FUNCTION
and cannot survive being stored as JSON, so it never reaches the browser — but
the label beside it is a string and does. What was missing is that the admin's
own type for a Single never declared the field, so nothing read it.

Two duplications are collapsed rather than extended. The default is derived in
one place now, shared by entries and Singles, so a second `?? "Preview"` cannot
keep the fallback after someone changes the real one. And a Single's schema
carried its own inline copy of the admin options, which had already drifted —
it was missing `order` and `sidebarGroup`, both of which the server sends. It
references the shared declaration instead, which is what made the label
invisible to the editor in the first place.

Editing that name now takes effect. A code-first Single's `admin` block was
written to storage only inside the branch that handles a SCHEMA change, and was
not one of the things that opened it — so renaming a preview, or changing the
Single's own label or description, reached the row only when some unrelated
field change happened to trigger a write. The admin reads all three from the
stored row, because a preview declaration's `url` is a function and cannot
travel over HTTP, so until then the editor kept showing the old name.

They are written by their own branch rather than by widening the schema one,
which would have flagged a migration for an edit that moves no column. The
collection registry already worked this way; the two now share one predicate for
the schema question instead of keeping two copies of it in step by hand.

The button that opens the pane is named by the same word. Renaming the pane
while its opener still said "Show preview" left the declared label reachable
only after clicking a control that disagreed with it, so the header takes one
label and gives it to both rather than growing a second naming prop.

Two ways the stored copy could go stale are closed with it. A config that
dropped its admin block or description while ALSO changing a field took the
schema path, which sent `undefined` — read as "leave the column alone" — and
stranded the old value. And the comparison that decides whether to write is now
insensitive to key order: Postgres holds these columns as `jsonb`, which
normalises the order it was given, so a plain JSON compare re-synced every
resource on every startup on that adapter alone.

`ApiSingle.admin.preview` also carries `openInNewTab`, which the collection side
has always read. It is a boolean, so unlike the `url` beside it, it survives
being stored and is returned — the type said otherwise, and a caller with a
stored value could not reach it.
