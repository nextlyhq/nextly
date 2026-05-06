# @nextly/tsconfig

Shared TypeScript configurations for the Nextly monorepo.

> Internal package. Not published to npm. Config-only, no build step.

## What this is

Five base `tsconfig.*.json` files used across the monorepo. Each package extends one of them in its own `tsconfig.json`:

- `base.json` – generic library base
- `base-bundler.json` – library base tuned for bundlers (tsup, esbuild)
- `react-library.json` – React component libraries
- `react-library-bundler.json` – React libraries built via bundlers
- `nextjs.json` – Next.js apps and templates

Example consumer (`packages/admin/tsconfig.json`):

```json
{
  "extends": "@nextly/tsconfig/react-library-bundler.json",
  "include": ["src", "scripts"],
  "exclude": ["dist", "node_modules"]
}
```

## Used by

Every workspace package and app. To enumerate consumers:

```bash
grep -lE '"@nextly/tsconfig":\s*"workspace:\*"' packages/*/package.json apps/*/package.json
```

## Development

See the [root README](../../README.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md).
