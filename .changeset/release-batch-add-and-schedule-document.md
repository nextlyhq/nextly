---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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

Releases gain two experimental operations that each do several things, all
of them or none, in one database transaction. A refusal, or a failed write
(the last one included), leaves no release, no document and no revision
change behind.

- Adding several documents to a release at once, each with its action:
  `nextly.releases.addMembers({ releaseId, members })`, or
  `POST /api/releases/:id/members/batch`. Each document is checked as adding
  it alone is checked, and a selection that would take the release past its
  200 documents is refused whole, saying how many fit. A hard problem in the
  refusal names its document in `data.problems[].document`. It is how the
  linked documents an add offers are added.
- Scheduling a document in one step:
  `nextly.releases.scheduleDocument({ into, document, linked, ... })`, or
  `POST /api/releases/schedule-document`. With `into: "own"` it makes a
  single-document release, scheduled; with accepted linked documents it makes
  an ordinary release holding them all. `into: "existing"` adds to an ordinary
  draft or scheduled release, and `into: "new"` makes a draft release.

Behaviour change: taking the document out of a single-document release that
has not run (draft, scheduled or stopped) now cancels that release through
the cancel operation, under its permission (`publish-content-releases`), and
keeps it as cancelled. Before, a draft or stopped one was left empty, and
the document of a scheduled one could not be taken out. Whoever may create
but not publish releases is now refused this, and the release's
`can.removeMember` says so.
