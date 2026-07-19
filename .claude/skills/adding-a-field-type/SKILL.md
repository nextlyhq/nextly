---
name: adding-a-field-type
description: Use when adding a new field type to Nextly (a new entry in the FieldType union, a new field factory, or a new schema-builder picker type), or when a field type renders or stores incorrectly across the config, catalog, column-mapping, or admin layers.
---

# Adding a field type to Nextly

## You might not need this

If the field type belongs to ONE plugin, do not touch core. Declare it in the
plugin's `contributes.fieldTypes` (`PluginFieldType`: type id, storage
primitive `text|longText|boolean|number|timestamp|json`, admin `component`
path, optional `surfaces`). The boot-time registry
(`packages/nextly/src/domains/schema/field-types/field-type-registry.ts`)
validates it, and the admin renders it via the component registry. The rest
of this skill is for BUILT-IN types only.

## The end-to-end recipe (built-in type)

Work through these in order; each layer has tests nearby to extend.

1. **Type union + config interface**
   - Add the literal to `FieldType` in
     `packages/nextly/src/collections/fields/types/base.ts`.
   - Create `packages/nextly/src/collections/fields/types/<type>.ts` with the
     config interface; export it from `types/index.ts` (this also feeds
     `ALL_FIELD_TYPES`).
2. **Factory**: add the helper in
   `packages/nextly/src/collections/fields/helpers.ts` following the existing
   `(config) => ({ ...config, type: "<type>" })` shape with a JSDoc example.
3. **Type guard**: add it in `collections/fields/guards.ts` via
   `createTypeGuard`, and decide membership in `isDataField` /
   `isRelationalField` / `hasNestedFields`.
4. **Catalog entry**: add to `FIELD_TYPE_CATALOG` in
   `collections/fields/catalog.ts` (label, category, hint, Lucide icon NAME
   as a string). Pickers render from the catalog automatically. If the type
   should appear on the user-fields or form surfaces, add it to those
   allow-lists too; if it is surface-only, do NOT add it to the canonical
   union (see the catalog's comment block for why).
5. **Column mapping (the single source of truth)**: add the per-dialect case
   in `packages/nextly/src/domains/schema/services/field-column-descriptor.ts`.
   Then verify the descriptor's `kind` is handled by
   `runtime-schema-generator.ts`, `pipeline/diff/build-from-fields.ts`, and
   the DDL emitters in `domains/schema/pipeline/ddl-emitter/`.
6. **Validation**: add a validator under `collections/fields/validators/` and
   the case in `domains/schema/services/zod-generator.ts` (the per-type
   switch).
7. **Type generation**: add the TS mapping in
   `domains/schema/services/type-generator.ts` so `nextly generate:types`
   emits the right property type.
8. **Admin rendering**:
   - Edit view: a component under
     `packages/admin/src/components/features/entries/fields/` and its case in
     `FieldRenderer.tsx`.
   - List view: cell rendering in the EntryList table components
     (`EntryTableCell.tsx` / `EntryTableColumns.tsx`).
   - Builder config: if the type has builder-editable options, extend the
     schema builder's field editor sheet under
     `packages/admin/src/components/features/schema-builder/`.
9. **Serialization extras** (check, usually small): the collection export
   service (`domains/collections/services/collection-export-service.ts`) and
   `domains/schema/services/schema-hash.ts`.

## Verify before opening the PR

- Unit tests at each touched layer (factory, guard, descriptor, zod, type
  generator) plus an integration test that creates a collection using the
  type. Because this workflow changes per-dialect column mappings and DDL,
  cover Postgres plus at least one of MySQL/SQLite (the CI matrix runs all
  three).
- `pnpm generate:types` output in the playground includes the new type
  correctly; the field renders in the playground admin (both light and dark).
- Run the schema-hash and export tests; a new type that changes hashing
  semantics needs a deliberate decision, not an accidental one.
- One changeset covering all packages (patch, alpha rules) since this
  touches published code.
