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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

`nextly generate:types` now writes files that compile in the app it writes them
into, whichever package manager installed it.

- Generated Zod schemas import `z` from `nextly/zod`, a new entry that
  re-exports the Zod Nextly itself depends on, instead of from `zod`. An app
  depends on `nextly` but need not depend on `zod`, and under pnpm or Yarn
  Plug'n'Play a bare `zod` import did not resolve there, so the schemas failed
  to compile ("Cannot find module 'zod'"). To combine generated schemas with
  your own Zod code, import `z` from `nextly/zod` as well, so both use one Zod
  instance. `nextly/zod` is a stable entry.
- The generated types file imports `nextly` itself (type-only, erased from every
  build) before augmenting it. An app that imported only subpaths such as
  `nextly/config` got "Invalid module name in augmentation, module 'nextly'
  cannot be found" (TS2664).
- In an app without a `src/` folder, the types file and the schemas go to
  `types/generated/` and `db/schemas/collections/zod/` rather than into a new
  `src/` folder, while `typescript.outputFile` and `db.schemasDir` are left at
  their defaults. A path you set is used as written.
- A relationship or upload field pointing at a built-in collection is typed
  with a type the file has: `users` as the generated `User`, and `media` as
  `MediaFile`, imported from `nextly` (the type `nextly.media.findByID`
  returns). They were typed as `Users` and `Media`, which nothing declared, so
  any app with such a field failed to compile once its types were generated. A
  collection you define with one of those slugs keeps its own interface.
- The blog template's featured-image alt text check reads the image through
  `nextly.media.findByID`, and refuses the save when the image cannot be read
  or no longer exists, rather than letting the post through unchecked.
- `create-nextly-app`, adding Nextly to an existing app without `src/`, now
  writes `typescript.outputFile` as `./types/generated/nextly-types.ts` instead
  of a `./src/...` path, so the types land beside the rest of the app.

An app made with an earlier release: run `nextly generate:types` again. In an
app without `src/`, the files previously written under `src/` can be deleted.
