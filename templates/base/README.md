# Base template

Shared scaffolding for all `create-nextly-app` templates. The CLI applies this template first, then overlays the user-selected template (`blank`, `blog`, or future) on top.

> Not user-selectable. You will not see "base" in the CLI menu. It is always applied beneath your chosen template.

## What's in here

- Admin route handler stub (`app/admin/[[...params]]/page.tsx`)
- Default API handler stubs
- Shared styles and Tailwind preset wiring
- Default `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`

## Maintainer notes

When editing files in `base/`, run the CLI against `--template blank` and `--template blog` locally to confirm both still scaffold cleanly:

```bash
pnpm --filter @revnixhq/create-nextly-app dev -- my-test \
  --template blank \
  --local-template ./templates \
  --skip-install

pnpm --filter @revnixhq/create-nextly-app dev -- my-test \
  --template blog \
  --local-template ./templates \
  --skip-install
```

See [CONTRIBUTING.md](../../CONTRIBUTING.md).
