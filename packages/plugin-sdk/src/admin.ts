/**
 * @nextlyhq/plugin-sdk/admin — the author-facing surface for plugin admin UI
 * (D19/D43). Register the React components referenced by `contributes.admin`
 * (menu/pages/settings/views) here, in a module imported by the Nextly admin
 * shell (which provides `@nextlyhq/admin` + React).
 *
 * @public Graduated in P9 — `plugin-form-builder` exercises the menu/pages/views
 *   registration. Dashboard widgets (`PluginAdminWidget`, D22) remain
 *   `@experimental` until M8. See `STABILITY.md`.
 */
export {
  registerComponent,
  registerComponents,
  registerKnownPlugin,
} from "@nextlyhq/admin";
export type { ComponentPath } from "@nextlyhq/admin";

/**
 * The unified admin data table + its extension points (@experimental). Render
 * `DataTable` (batteries-included) or `DataTableView` (controlled) to match the
 * admin's lists, and contribute cell renderers, columns, column transforms, and
 * row/bulk actions to any list. Contributions are keyed by a list `target`: a
 * collection slug, a fixed key like `"users"`/`"media"`, or `"*"` for all lists.
 */
export {
  DataTable,
  DataTableView,
  registerCellRenderer,
  registerColumns,
  transformColumns,
  registerRowAction,
  registerBulkAction,
} from "@nextlyhq/admin";
export type {
  DataTableProps,
  DataTableViewProps,
  DataTableSelection,
  DataTableTarget,
  DataTableContext,
  ColumnProvider,
  ColumnTransform,
  NextlyColumn,
  NextlyFieldType,
  NextlyFieldSchema,
  CellContext,
  CellRenderer,
  CellRendererDefinition,
  RowAction,
  BulkAction,
} from "@nextlyhq/admin";

/**
 * The field-UI kit (@experimental): controlled, form-library-agnostic
 * field-building components rendered from `nextly/field-catalog`. Each has a
 * narrow, storage-agnostic contract that never exposes admin internals, so a
 * plugin can build a field editor without importing from `@nextlyhq/admin`:
 * - `FieldTypePicker` — catalog-driven type grid; pass your surface's allowed
 *   `types` or pre-narrowed `entries`.
 * - `FieldOptionsEditor` — an option list with drag reorder, auto-generated
 *   values, CSV/JSON import, and whole-batch duplicate reporting;
 *   `withOptionIds` seeds drag ids onto plain `{label,value}` data.
 * - `FieldDefaultValueInput` — a type-aware default-value input.
 * Compose them in plugin admin surfaces so field editing looks and behaves
 * like the rest of the admin; your plugin owns storage and the allowed-type
 * subset. See `STABILITY.md`.
 */
export {
  FieldTypePicker,
  FieldDefaultValueInput,
  FieldOptionsEditor,
  withOptionIds,
} from "@nextlyhq/admin";
export type {
  FieldTypePickerProps,
  FieldDefaultValueInputProps,
  FieldDefaultOption,
  FieldOption,
  FieldOptionsEditorProps,
} from "@nextlyhq/admin";

// The declarative `contributes.admin` contract types (the same ones exported
// from the package root) for convenience when authoring admin components.
export type {
  PluginAdminContributions,
  PluginAdminPage,
  PluginCollectionView,
  PluginMenuItem,
} from "nextly";
