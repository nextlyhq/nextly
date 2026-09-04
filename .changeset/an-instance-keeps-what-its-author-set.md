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

Copying a component also broke the relationships built on its ids. A heading
that names a field, or help text a control points at, is wired together by id —
and moving the ids without moving the references left every one of them
pointing at something that no longer exists, so a screen reader announced the
control with no name and no description at all. References now move with their
targets, including inside patterns, where the same copy had the same effect. A
reference to something the copy does not contain is left alone.

Three smaller repairs. A component instance stored with an empty visibility
setting could stop a page rendering outright. A component whose own visibility
setting could not be read was being rewritten into one that reads as
unrestricted, which would have published content that was meant to be withheld.
And content left behind under a slot a component no longer offers was still
counted against the page's size limit even though it is discarded, so a page
could be refused a component that would have fitted.

Four smaller repairs found the same way. Content a page places inside a
component kept its own id references, instead of having them redirected at the
component's copies. A block hidden by an instance no longer counts against the
page's size limit, since it draws nothing. A component whose visibility setting
was stored empty now takes the instance's per-screen hiding like any other. And
copying a pattern no longer fails on a node whose attributes were stored empty.
