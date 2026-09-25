<!-- Generated from AGENTS.md by `pnpm instructions:sync` (648e1550fd9b77d0). Edit that file, never this one. -->

# packages/admin: Agent Guide

Admin panel UI. Read the root AGENTS.md first; this file adds what only
matters inside `packages/admin`.

## Styling rules (strict)

- All admin styles are scoped under the `.nextly-admin` wrapper by a
  build-time CSS scoper (`scripts/build-css.mjs`; the scoper has its own
  tests in `scripts/*.test.mjs`).
- Design tokens only: `--nx-*` custom properties defined in
  `packages/ui/src/styles/theme.css` for light AND dark. Zero hardcoded
  colors. Every visual change must be checked in both modes; there are no
  single-mode changes.

## Data and errors

- Parse API errors with `src/lib/api/parseApiError.ts` against the canonical
  `{ error: { code, message, requestId, data? } }` envelope. Do not throw or
  expect `NextlyError` here; that class belongs to the core package.
- Prefer type-only imports from `nextly/config` (field types and guards) so
  admin does not pull Next-coupled runtime code. The serializable field-type
  catalog is imported from `nextly/field-catalog`.
- `@tanstack/react-query` is externalized from the bundle and resolved from
  the consumer's node_modules. Keep it (and the other externals listed in
  `tsup.config.ts`) out of the bundle.

## Component conventions

- Tables: reset pagination when search or page size changes, set `getRowId`,
  and preserve cross-page selection semantics (follow the existing table
  components).
- Field editors: the shared field-UI kit lives in `src/components/field-ui/`
  (`FieldTypePicker`, `FieldDefaultValueInput`, `FieldOptionsEditor`) and is
  re-exported through the plugin SDK as experimental surface. New field
  pickers must render from the catalog, never from a hand-written type list.
- Entry field rendering goes through
  `src/components/features/entries/fields/FieldRenderer.tsx`; list cells
  through the EntryList table components.

## Code Review Rules

Adds to the root `Code Review Rules` for changes under `packages/admin`. The
design-token lint and the CSS scoper's own tests already run in CI; these are
the behaviours neither can see.

### Every visual change works in both colour schemes

There are no single-mode changes. Flag a change that adjusts appearance without
evidence it was checked in dark as well as light — a token chosen for its light
value, a border that vanishes on a dark surface, a focus ring with no contrast
in one mode. Naming the `--nx-*` token used is the safe path; the lint catches
a hardcoded colour but not a token that reads wrong in one scheme.

### Field pickers render from the catalog

Flag a hand-written list of field types anywhere in the admin. The serializable
catalog at `nextly/field-catalog` is the one source; surfaces narrow it with
`narrowFieldTypeCatalog` rather than redeclaring it. A second list drifts the
moment a type is added.

### Table state has invariants a type cannot express

Flag a table that does not reset pagination when the search term or page size
changes, omits `getRowId`, or breaks selection across pages. Each reads as
working until the second page.

### The error envelope is parsed, not thrown

`NextlyError` belongs to the core package. Flag admin code constructing or
expecting it rather than parsing the `{ error: { code, message, requestId } }`
envelope through `src/lib/api/parseApiError.ts`.

### Externalized dependencies stay out of the bundle

Flag a change that pulls `@tanstack/react-query`, or another dependency listed
as external in `tsup.config.ts`, back into the bundle. The consumer resolves
these from their own `node_modules`, and bundling one produces two copies with
separate state.
