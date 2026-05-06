# Nextly Templates

Starter templates for the `create-nextly-app` CLI. Each template is a pre-configured project setup with collections, frontend pages, and (optionally) seed content.

## Available templates

| Template  | Description                                                                                | Status |
| --------- | ------------------------------------------------------------------------------------------ | ------ |
| **base**  | Shared foundation (admin routes, API handlers, styles). Not selectable directly.           | Stable |
| **blank** | Empty config for building from scratch.                                                    | Alpha  |
| **blog**  | Blog with posts, categories, tags, users-as-authors, frontend pages, RSS, sitemap, search. | Alpha  |

See [`templates/base/README.md`](./base/README.md), [`templates/blank/README.md`](./blank/README.md), and [`templates/blog/README.md`](./blog/README.md) for per-template details.

## How templates are used

The CLI downloads templates from this directory at runtime via GitHub's Codeload API. The `base` template is always applied first, then the selected template (`blank` or `blog`) overlays its files on top.

For local development, use `--local-template` to read from the filesystem:

```bash
pnpm create-nextly-app@latest my-blog \
  --local-template ./templates \
  --template blog \
  --use-yalc
```

## Template structure

Each user-selectable template directory contains:

```
templates/{name}/
├── template.json              # Manifest with metadata for the CLI
├── configs/                   # Approach-specific nextly.config.ts variants
│   ├── codefirst.config.ts    # Code-first approach (full schemas in TypeScript)
│   └── visual.config.ts       # Visual approach (schemas via Admin Panel)
├── seed/                      # Demo content (optional)
│   ├── nextly.seed.ts         # Seed script
│   ├── seed-data.json         # Content entries
│   └── media/                 # Sample images
└── src/                       # Frontend pages and components
    ├── app/(frontend)/        # Route group pages (homepage, blog, etc.)
    └── components/            # Reusable UI components
```

The `base` template has no `configs/`, `seed/`, or frontend pages; it ships shared scaffolding only. The `blank` template has only a `template.json` and a `nextly.config.ts`.

## Creating a new template

1. Create a directory under `templates/` with your template name.
2. Add a `template.json` manifest (see the schema below).
3. Add approach-specific configs in `configs/` if your template has content schemas.
4. Add frontend pages in `src/app/(frontend)/` and components in `src/components/`.
5. Add seed data in `seed/` if your template ships demo content.
6. Update `AVAILABLE_TEMPLATES` in `packages/create-nextly-app/src/lib/templates.ts`.

## template.json schema

```json
{
  "name": "template-name",
  "label": "Display Name",
  "description": "Short description for the CLI prompt",
  "hint": "Brief hint shown next to the label",
  "approaches": ["code-first", "visual"],
  "defaultApproach": "code-first",
  "collections": ["collection-slugs"],
  "singles": ["single-slugs"],
  "hasDemoData": true,
  "hasFrontendPages": true,
  "recommendedDatabase": "any",
  "release": "alpha"
}
```

Set `approaches` to an empty array for templates that do not need approach selection (like `blank`).
