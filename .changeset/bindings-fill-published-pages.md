---
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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

Stored bindings now fill their props on published pages. Before blocks render,
one pass checks each binding and fills its prop from the entry the page shows,
the list item a collection loop is drawing, a Single or the public site
settings, following one to-one relation at most. An empty value shows the
binding's fallback, or the prop's own value when there is none. The routes read
the entry, each Single and the site settings a page binds, and the related entry
a path follows, through the public reader, and check each binding against the
field shapes the public may see.

Bindings are read with a visitor's access. `createBlocksPage` and
`createPublicBlocksPage` read the entry again through the route's public reader
for the fields the page binds, at one claim on the page's query budget, rather
than using the row the route resolved: a public route reads that row with
trusted access, and a draft preview reads the draft. So a field the public may
not read shows the fallback, and a preview shows the published values.

Dates, numbers and currency amounts format in the page's language. A date picked
as a day keeps its day in every time zone, a month shows its month and year, and
a time of day shows only its time; a date-time is shown in the route's new
`timeZone` option, else the site's time zone, else UTC. Every block receives the new `bound` render
argument (`@experimental`), which carries a bound date's machine-readable value,
and the core heading, text, quote and button blocks wrap a bound date in
`<time datetime>`.

A binding stored before these checks existed may break them. None fails the
page: a binding to a prop the block does not have fills nothing, a format this
release does not apply (`relativeTime`, `list`) shows the value as it is when it
fits, and any other broken binding shows its fallback, or the prop's own value
when the fallback is not valid. Each is reported through `PageRenderer`'s new
`onBindingIssues`, and the routes log one warning per report.

Compatibility: a page that stored bindings through the API showed each bound
prop's own value until now, and now shows the bound value. Pages without
bindings render exactly as before. `PageRenderer` takes the new `bindings` and
`onBindingIssues` props; `PageContext` gains `itemSource`; `DocumentReadStages`
gains the `bound`, `boundValues` and `bindingIssues` stages, and
`prepareDocumentAsDrawn` returns the bound stage. The validator accepts an
optional `bindingSchema` that checks each binding's path, field and format, and
its issue codes gain the binding codes; `ISSUE_CODES` is now typed as a record
of `IssueCode` to `string`, so a caller that read a description's literal type
reads `string`. `@nextlyhq/blocks-engine` exports the binding vocabulary
(`BindingValueKind`, `FIELD_TYPE_BINDING_KIND`, `BINDABLE_KINDS`,
`STORAGE_PRIMITIVE_AS_FIELD_TYPE`, `BindingEndpoint`, `bindingKindOf`,
`canBindFieldToProp`), `@experimental`. `BlocksPublicReader` gains an optional
`findSingle`. A route prepares each document once per render and hands that to
the renderer. Existing callers that pass none of these see no change.
