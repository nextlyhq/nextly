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

fix(blocks-react): resolve every shared site-style input once per render

A render carries two style inputs — the route's `styleContext` and the site's
`siteStyles` — and compiles twice from them: the shared sheet, and the page's
own values. Only the class library was reconciled between them. `breakpoints`,
`tokenPrefix` and `blockBases` were each computed twice, so a stored value that
reached the sheet never reached the page compile.

The consequences were silent, because each sheet is internally consistent and
neither reports anything. A stored breakpoint set replaces the config one
whole, so a node's value stored under an id the route's set lacks was dropped
outright; a stored token prefix left every `{ $token }` reference pointing at a
custom property nothing declared, and an unresolved custom property invalidates
the declaration rather than reporting.

`PageRenderer` now resolves the shared inputs once and gives the same values to
both compiles. Precedence is unchanged for every field — the defect was two
computations of one question, not the wrong answer to it. A table typed over
every `SiteSheetInput` key records which side each belongs on, so a field added
there is a compile error until someone says.

**Breaking, alpha:** a `siteStyles` PROVIDER is now `{ read, singles }` rather
than a bare function. Being called per render is not the same as being read per
render — on a pre-rendered route the whole render is cached and only a tag the
page carries rebuilds it, while a Direct API read inside the provider
contributes none. `singles` names the slugs that read consults, which puts
`nextly:single:<slug>` on the route, so an admin's save reaches the next page
view as the documentation already promised.

The two are one type rather than a value and a separate optional property,
because an optional one leaves the unsafe configuration legal: a provider with
no declared dependencies compiles, serves a stale sheet, and looks exactly like
a correct route. `singles: []` states that a provider reads no singles. A plain
value needs none of this — it cannot change after the module loaded.

The Site Style write validators also judged the stored tier alone, while every
consumer compiles the merge. Config entries are inserted first and both engine
resolutions are first-wins, so a stored class whose slug a config class already
holds was accepted, then dropped at render, leaving the node that referenced it
with no rule — and `MAX_NAMED_CLASSES` was counted over the stored array while
the compiler truncates the merged one. Both are judged against the merge now,
when a caller states its config tier. Token collisions are reported as the
DIFFERENCE the write introduces, so a site whose own config already emits an
issue does not have someone else's mistake charged to the admin saving a token.

The configured breakpoint set threaded into the blocks field validator was
inert: an unknown breakpoint is a warning under forgiving validation and the
error filter dropped it, so no document was judged differently by the set. It is
reported once a set has actually been wired in, and stays silent against the
empty fallback, where every id would be unknown and every styled document would
be refused.
