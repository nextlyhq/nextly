# @nextlyhq/blocks-react

## 0.0.2-alpha.52

### Patch Changes

- [#539](https://github.com/nextlyhq/nextly/pull/539) [`49d44ae`](https://github.com/nextlyhq/nextly/commit/49d44ae78d13ae0fa52f241fcfbdbf5fd19485a1) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - feat(blocks-react): add the React renderer package boundary

  Adds `@nextlyhq/blocks-react`, the React/RSC renderer for Nextly block
  documents. This change lands the package and its layering guarantees; the
  renderer itself follows.

  The root entry imports no `next/*`, no admin code and no CMS runtime, so a
  document can be rendered from a plain React app, a test or a script. Everything
  Next-coupled lives at the `@nextlyhq/blocks-react/next` subpath, so importing
  the renderer never pulls Next into a consumer's module graph. Both rules are
  enforced by an allowlist-based import test rather than by convention.

  `PageContext` and `BlocksDataProvider` are also introduced: the seam through
  which data, media URLs and entry paths reach a block, so blocks never reach for
  a database directly.

- Updated dependencies [[`4902ef4`](https://github.com/nextlyhq/nextly/commit/4902ef42388fc4317d5b8e98ed6729184608c58d), [`8bdf575`](https://github.com/nextlyhq/nextly/commit/8bdf575b5837387973ffc226f1820f79abb7b2f4), [`49d44ae`](https://github.com/nextlyhq/nextly/commit/49d44ae78d13ae0fa52f241fcfbdbf5fd19485a1), [`d53bc9f`](https://github.com/nextlyhq/nextly/commit/d53bc9ffd2b9d28a2b5f33ee5f6f3199f74fecfb), [`bffeac4`](https://github.com/nextlyhq/nextly/commit/bffeac4b3e7b8dbf834a8c76bd2b45f65728a9cb), [`938898d`](https://github.com/nextlyhq/nextly/commit/938898d1daf26e1bad8a84f3e46eec55570f4e41), [`a281098`](https://github.com/nextlyhq/nextly/commit/a281098de1cd45a7a089af7a5e8f04a1673e6c4f), [`17be415`](https://github.com/nextlyhq/nextly/commit/17be4155dcf03bd917cc547293dd5b6ee806256e), [`d58130a`](https://github.com/nextlyhq/nextly/commit/d58130a0679313f5819de7e71242e3afde130a01), [`3a1b43b`](https://github.com/nextlyhq/nextly/commit/3a1b43b754392c33c58452c945a8eaa537463f04), [`4f009ae`](https://github.com/nextlyhq/nextly/commit/4f009ae2b05799234c4d07442ea61c4f1799dff7), [`f835ca9`](https://github.com/nextlyhq/nextly/commit/f835ca9680c7bd12d5e512092ae23958eb49292f), [`72c894b`](https://github.com/nextlyhq/nextly/commit/72c894b89f68667af2e2b16e79a1795bdbca10fa), [`9ccff93`](https://github.com/nextlyhq/nextly/commit/9ccff938431db8afba3f67bf5f5107ee8448388c), [`6c77f8f`](https://github.com/nextlyhq/nextly/commit/6c77f8f196acd65848dd4348a277ebec6b07f710)]:
  - @nextlyhq/blocks-engine@0.0.2-alpha.52
