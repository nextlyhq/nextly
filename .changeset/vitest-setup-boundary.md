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

Make the two test-environment rules boundaries in the page-builder packages, rather than conventions each test file had to remember.

Neither `@nextlyhq/builder` nor `@nextlyhq/plugin-page-builder` configured a vitest setup file, and both rules they were missing fail silently and in the reassuring direction — a test file that forgets either one goes on passing.

Renders were never torn down between cases unless a file registered its own cleanup, so a file without one accumulated every render into a single document and `querySelector` answered with the first case's element: later cases asserted against a tree belonging to a test that had already finished, and agreed with it.

`React.act` refuses to run unless `IS_REACT_ACT_ENVIRONMENT` is set, and the refusal is a warning rather than a failure, so a file missing it drove nothing, asserted against the first render, and passed. Exactly one file in the repository set it, and had to set it itself.

Both packages now load a setup file that does the work only where a DOM exists, so it stays inert for the node-environment files that make up most of each package. Each package also gains a test asserting what the setup file produces, because a setup file's effect is not observable from any ordinary suite going green — which is the shape it exists to prevent.

No behaviour changes for anyone using these packages; this is test-environment correctness.
