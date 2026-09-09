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

Release verification gave up on the registry after 24 seconds, so a complete
release was recorded as incomplete and never got its git tag or its GitHub
release.

A publish is not one event. `changeset publish` returns once npm has accepted
every tarball, and the packages become readable on the packument endpoint some
time after that. Across a twenty-package train accepted within one second of
itself, the last four became readable 47s, 125s, 179s and 186s later, against a
verification budget of five attempts six seconds apart.

The budget is now a deadline of ten minutes with backoff from 5s to 30s, sized
against the measured settle rather than an assumption about it, and the two
mistakes are not symmetric: publishing has already succeeded when this runs, so
waiting longer spends CI minutes, while giving up early withholds the tag from a
release npm accepted.

The registry read now also revalidates rather than accepting a cached
packument. Every caller asks what is true now, and a cached answer would have
the verification spend its whole budget re-reading one stale copy.

`verify.mjs` was the only script in the release directory with no tests. Its
waiting and its verdict move to `lib.mjs` behind an injected clock, and nine
cases cover them, including the control that a longer wait still reports a
package the registry never received.
