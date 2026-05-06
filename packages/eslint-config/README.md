# @nextly/eslint-config

Shared ESLint configuration for the Nextly monorepo.

> Internal package. Not published to npm.

## What this is

Three named exports for different consumer types:

- `./base` – the base config used by every package
- `./next-js` – extension for Next.js apps and templates (extends `./base` with Next.js rules)
- `./react-internal` – extension for internal React libraries like `@revnixhq/admin` and `@revnixhq/ui`

## Used by

Every workspace package. To enumerate the current consumers:

```bash
grep -lE '"@nextly/eslint-config":\s*"workspace:\*"' packages/*/package.json apps/*/package.json
```

## Development

See the [root README](../../README.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md).
