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
