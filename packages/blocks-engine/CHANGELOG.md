# @nextlyhq/blocks-engine

## 0.0.2-alpha.40

### Patch Changes

- [#325](https://github.com/nextlyhq/nextly/pull/325) [`823950b`](https://github.com/nextlyhq/nextly/commit/823950baac1c7302a53b9ca799b6ff517a36b9d5) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/blocks-engine` can now upgrade page documents when a block's schema changes. Blocks that were saved against an older version are automatically brought up to date, one version step at a time, so old pages keep working after a block is improved. If a step is missing or fails, that block keeps its last-good content and is marked so the page shows a placeholder for it instead of breaking, and the failure is reported to the caller.

- [#320](https://github.com/nextlyhq/nextly/pull/320) [`17819aa`](https://github.com/nextlyhq/nextly/commit/17819aaf1642b63c2bc7042e451eef9219275063) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - New package `@nextlyhq/blocks-engine`: the foundation of the rebuilt page builder. It ships the stored document format (pages as a plain list of blocks with typed styles, data bindings, visibility rules, and locale-overlay support) plus the pure tree operations editors and tools build on. It is dependency-free and works in any JavaScript runtime, so page documents can be created and edited outside the admin too.

- [#324](https://github.com/nextlyhq/nextly/pull/324) [`a4c38ec`](https://github.com/nextlyhq/nextly/commit/a4c38ec6475299e1a6d2d6c39cb24326706f5474) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - `@nextlyhq/blocks-engine` now validates page documents and reports problems in a machine-readable form. Each issue carries a precise location in the document, a stable code, and a suggested fix, so tools and AI agents can pinpoint and repair exactly what is wrong. Validation runs in a strict mode (used when publishing, where unknown blocks or missing breakpoints are errors) or a forgiving mode (used when rendering, where those become warnings so a page still displays what it can).
