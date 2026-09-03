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

A component instance that an author had hidden was published to everyone. The
instance node carried the visibility rule; composition replaced it with the
component's own blocks, and the rule went with it — so the pass that withholds
hidden content found nothing left to withhold, and content restricted to one
audience was served to every visitor. An instance an author hides is now left
in place for that pass to remove, and hiding a component at one screen size
carries onto everything it draws.

Placing the same component twice also published its HTML ids twice. Anchors,
`<label for>` and id selectors then reached whichever copy the browser found
first. Each instance now derives its own, by the same rule that already applies
when a pattern is inserted, so a page holding both carries one spelling rather
than two.

Three limits were not the limits they claimed to be. A page's node cap counted
only what composition added, so a full page could resolve to twice the cap
while every later pass believed it was reading a bounded document. Slot content
left behind under a slot a component no longer offers was composed in full
before being discarded, which could exhaust that cap and cost the page a
component it does show. And a component's overrides were counted only after the
whole record had been read, so an oversized one was never bounded at all.

A page, a region or a template supplied where a component was expected is now
refused instead of being drawn as though it were one.
