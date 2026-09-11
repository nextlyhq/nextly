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

`nextly.group` and `nextly.timeseries` now work on the documented instance.
`getNextly({ config })` builds its object by binding one method at a time and
forwarded neither, so both were `undefined` on the path the docs recommend
while working through the lazy singleton — `group` since it shipped. A test now
compares the instance against the Direct API's own surface, so the next
omission fails rather than reaching a consumer.

A yearly timeseries no longer reports zeros. The documented maximum of 366
intervals starts in 1661, and MySQL renders that bound with `FROM_UNIXTIME`,
which answers NULL outside its range — so the predicate meant to bound the scan
matched nothing. A bound outside what the column can store is now omitted,
which excludes no row that could exist.

A timeline refuses earlier and more clearly. A malformed date field is named
rather than surfacing as a server fault; an unsupported interval is judged after
collection authorization, so an untrusted caller gets the access refusal rather
than a response that confirms the collection exists; and the window and the
release visibility now resolve against one clock.

A collection source describes what its timeline can actually do. It advertises
`timeseries` only when it exposes a date the read would accept, and marks a date
the read would refuse so a dashboard cannot register a card that fails on every
load.
