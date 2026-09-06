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

A pattern saved from the page had its DOM ids rewritten. A block whose `cssId`
an author typed as `hero` was stored as `hero-3ee4a0d4`, and that value is one
people read and write: it appears in a URL fragment, in a stylesheet and in the
attribute panel.

An id is rewritten so that a copy placed BESIDE its original does not emit the
same HTML `id` twice. That is the only reason for it, and neither saving nor
inserting was asking whether it applied: a saved run becomes a document of its
own and is beside nothing, and inserting into a page holding no `hero` renamed
it regardless.

Both now rename only what would actually collide. Saving keeps every id;
inserting keeps the ones its destination does not already hold, and steers
around the ones it does. Starting a page from a full-page pattern keeps them
all, because that replaces the page's blocks rather than joining them.

The rewriting had two further costs. Saving one selection twice produced two
different documents, so anything fingerprinting a pattern's content reported a
change nobody made. And the suffixes accumulated: saving, inserting and saving
the copy back grew the id by nine characters each time round, with no bound.

Saving a selection over an existing pattern is now planned as well, so a
library does not fill up with `hero-v2` and `hero-v2-final`. It replaces the
pattern's content and leaves the row's own name and description alone, and it
brings the run it was saved from back into sync — without it, blocks that had
just defined a pattern would report themselves out of date against it.

Saving a selection also now refuses what inserting it would refuse: a block the
editor could not place, one nested somewhere the rules no longer allow, two
blocks sharing a single HTML `id`, or a page written in a format this version
does not accept. Pages are saved forgivingly and the rules move underneath
them, so each of those could be sitting in a page that renders — and saving one
produced a library entry that could be seen, could not be placed anywhere, and
said nothing about why until someone tried.

A block can name its HTML `id` two ways — the field in the panel and the
custom-attributes escape hatch beside it — and the page shows only one of them.
Four places in the codebase worked out which one for themselves, and two got it
wrong in ways an author would see: a block was refused an id no other block was
using, and a copied block was renamed to avoid an id that was never on the page.
There is now one answer, and everything asks it.
