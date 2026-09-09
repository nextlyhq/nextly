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

A form-builder suite that boots a real Nextly instance ran in the unit lane,
where it timed out and turned `main` red.

The two lanes are told apart by filename: the unit config excludes
`src/**/*.integration.test.ts` and the integration config claims exactly that
suffix. `prepare-submission.test.ts` was named for the unit lane and its last
group boots core three times through `createTestNextly`, so those boots ran
under a 10s budget sized for jsdom component tests, in parallel with the rest
of the monorepo. That package's own config records why the split exists: a boot
competing with the monorepo reached 30556ms on CI while the same file finishes
in about 1.6s alone.

The three cases that boot an instance move to
`prepare-submission.integration.test.ts`, where the budget is 30s and files do
not run in parallel. The pure cases stay where they are. No assertion changed.
