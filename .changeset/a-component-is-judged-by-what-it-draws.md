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

A component the editor offers, and one the canvas draws, are now judged
against the same forest and read from the same row.

A saved pattern keeps the instance nodes it held, so a pattern that places a
component is a second way to copy that component into itself; editing a
component now withholds those patterns by the same graph the component tier is
filtered by. A pattern's nested instances are judged by what they DRAW rather
than by the reserved instance type, which a parent rule read as unrestricted
and a slot's admissions list refused outright — so a component drawing exactly
what a slot asks for could not be placed in it, and one whose root belongs
elsewhere could.

The roots query follows a nested instance's own overrides, so a component whose
only root that instance hides is no longer offered as placing something; and it
survives a definition whose fields throw rather than taking the insert panel
down with it.

The library is paged from the last row seen rather than from an offset, so a
component inserted or deleted by another author while the editor loads it can
no longer be skipped and reported as a complete library. A completed component
must be the row the listing named and must have been read whole: a row
answering under a different id, or one whose document field an access rule
removed, is left out and the tier reported cut rather than served under another
component's name. Its keywords travel, so the palette can find it by them, and
a store the plugin was told about is gated by the slug it actually reads.

The entry form's resting miniature reads the component library only when its
page places a component, instead of on every mount of every blocks field.

An exposed visibility control now reflects a gate the component itself carries,
rather than reporting a node as shown on a page the renderer withholds it from.
