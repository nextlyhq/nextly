# @nextly/prettier-config

Shared Prettier configuration for the Nextly monorepo.

> Internal package. Not published to npm.

## What this is

A single Prettier config exported from `./index.js`. The repo's `lint-staged` setup imports it directly; package-level Prettier consumers extend it via the `prettier` field in their `package.json`:

```json
{
  "prettier": "@nextly/prettier-config"
}
```

## Used by

The repo-level `lint-staged` config and any workspace package that opts in via `prettier: "@nextly/prettier-config"` in `package.json`.

## Development

See the [root README](../../README.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md).
