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

A page could reference a reusable component and nothing drew it. The engine
knew how to replace the reference with the component's own blocks, but no
reader ran that step — so the renderer, the stylesheet, the page reader and the
route helper all worked from a document with a hole in it.

Composition is now a pass of the pipeline every one of those readers already
shares, so a component resolved for one of them is resolved for all four. It
runs before migration, so a component authored against an older version of a
block is brought up to date like any other content rather than handed over as
stored, and the components themselves are repaired against the same limits the
page is — an unchecked block inside a component would otherwise reach the page
through a door the page's own checks had closed.

A page also reports which components it drew and which it could not, so
whatever fetched them can keep the page up to date when they change.

A component that could not be loaded now says so where it sits, instead of
reading as an unrecognised block. A stored stylesheet is no longer reused once
composition has added blocks it was never compiled for, which would have left
every one of them unstyled on a page that looked fine.

Two limits behaved wrongly at the edges. A component larger than the page's
size limit was quietly trimmed to fit before anything could object, so the page
published part of a component with nothing to say the rest was missing; the
limit is now enforced where it can be reported. And the editor's style
explanations were computed without the components the page draws, so what an
author was told about where a value came from described a different page from
the one in front of them.

A component that arrived broken — empty, or not a document at all — brought
down the whole page, including pages that never used it. Such an entry is now
skipped and the reference it was for is reported as missing, like any other
component that could not be found.

Three more repairs at the same seam. A component that arrives as something
other than a document — an empty object, or a page saved under a component's
name — used to compose to nothing at all, so its whole region vanished from the
page with nothing to say why; it is now reported like any other component that
could not be loaded. A stored page can no longer claim one of its own blocks is
an unloadable component and have that believed. And a page now prepares only
the components it actually uses, following one component's reference to
another, instead of paying for the whole library on every render.

Three last repairs at the same seam. A page that referenced several components
it could not find could lose a component it COULD find, depending on the order
the references happened to appear in. A component stored in a format this
version does not understand is now reported rather than reshaped and drawn. And
the renderer and the page reader now agree about what an unloadable component
is, so the renderer no longer hides a block the reader returns.

One walk instead of two. Preparing a component and deciding to read one were
separate passes over the page, and they could disagree — so a component chosen
by an instance's override, one that survived a definition's own repair, or one
sitting past a truncated scan was reported as missing even though it had been
supplied. There is now a single answer, given where the component is actually
wanted, which also means a page follows a chain of components only as far as it
can draw it rather than preparing every component the chain names. And a
component whose stored data cannot be read is now reported as a fault in that
component, so the message points at it instead of at the page holding it.
