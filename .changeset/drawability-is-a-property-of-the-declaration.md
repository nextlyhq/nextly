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

Whether core can draw a widget is now a question about the DECLARATION, not just its archetype.

An archetype having a renderer says nothing about whether that renderer can draw a particular widget: a `list` needs its query to `select` the fields each row shows, and the same renderer that claims the archetype refuses a declaration without them. Treating those as one question cost two things.

A list widget that selects nothing had its query batched anyway. The refusal arrived only after the request came back, so the server performed an unprojected read, shipped every accessible document to the browser, and the card discarded them to print "selects no fields" — on every mount and every window-focus refetch. The declaration is refused before the batch is built now, so the card says the same thing without a database read.

And a widget declared through both channels lost its plugin component. The contributed component is the fallback for a widget core cannot draw, and core reported that it could — so a registration naming `list` without `select` replaced a working plugin card with an error. The fallback now asks whether this declaration is drawable, so the component stays.

An archetype states its own precondition beside its body, and returns the reason rather than a boolean, so the card explains what is missing in the words of the archetype that knows.
