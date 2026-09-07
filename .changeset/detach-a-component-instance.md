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

Detach a component instance: inline what it was drawing, and stop tracking it.

The instance is replaced, where it stands, by the nodes it rendered — the
definition's tree with this instance's overrides, variant and slot content
already applied. Afterwards the author owns those nodes and an edit to the
definition no longer reaches them, which is the point: detach is how a page
keeps what a component gave it without staying bound to it.

The inlined content comes from the renderer's own resolver rather than a second
traversal of the definition, so what an author gets is what they were looking
at. A planner that re-applied overrides and slots itself would agree with the
page until one of the two moved, and the difference would be silent.

**A component the author dropped INTO the instance stays a component.** That is
their content, not the definition's, and detaching its host says nothing about
it. It cannot be had from the resolver's depth cap: that bounds nesting inside a
DEFINITION, while supplied slot content is composed in the host's own scope
where the depth never advances — measured, a nested instance was fully inlined
and lost its link. So supplied content never reaches the resolver at all; it is
lifted out, stood in for, and put back.

**Two halves, two rules.** Supplied slot content MOVES: same node ids, same
authored DOM ids, because it is the same content in a new parent and the
instance holding it goes in the same edit. The definition's contribution is a
COPY: fresh node ids, and its authored DOM ids kept except where the page really
holds that name.

Nothing the resolver mints for rendering is stored. It scopes a DOM id per
composed node so two instances cannot collide, and `resolveComponentInstances`
now reports what each scoped id was derived from — without that, detaching wrote
a render-time digest into the database as though an author had typed it, and it
went stale the moment the definition renamed its own anchor.

Provenance goes on the existing `origin` record's `component` arm, which the
format already describes as "detached from a component, severing the link
deliberately" — no digest, because detaching is the act of declining further
change.

`resolveComponentInstances` also stops letting a supplied definition's own
accessors escape. It reads a definition's `kind` to tell a component from a page
and its `nodes` to tell a document from anything else, and a field that computes
itself and throws took the caller's error out of a function that promises a
classification and a closed list of reasons — out of the renderer and the
preview as much as out of detaching. Such a definition is now reported
`unreadable`, which is what that reason already meant: a value that IS supplied
and cannot be read.
