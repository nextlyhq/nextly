# Collections

Code-first collections. Each collection is defined via
`defineCollection({ ... })` from `nextly/config` and wired into the
root `nextly.config.ts` as part of the `collections: [...]` array.

Conventions:

- Trivial collections (a few scalar fields, no hooks): single file
  named after the collection (e.g. `Categories.ts`).
- Complex collections (many fields, hooks, or per-collection helpers):
  folder named after the collection, with `index.ts` exporting the
  collection definition and a `hooks/` subdir for hooks specific to
  that collection (e.g. `Posts/index.ts` + `Posts/hooks/`).
- Imports inside collection files use relative paths (`../access/...`)
  rather than the `@/` alias because `nextly.config.ts` is loaded by
  the CLI through plain Node.js module resolution, which does not
  honour TypeScript path aliases.

Skip this folder if you're using the Visual Schema Builder (admin UI)
to manage your schemas — UI-built collections live in the database, not
on disk.
