/**
 * Unified DataTable public surface.
 * @module components/ui/table/data-table
 */

export { DataTable } from "./DataTable";
export type { DataTableProps } from "./DataTable";
export { DataTableView } from "./DataTableView";
export type { DataTableViewProps, DataTableSelection } from "./DataTableView";
export {
  defineCellRenderer,
  getCellRenderer,
  getRegisteredCellTypes,
  resolveCellRenderer,
  textRenderer,
} from "./cell-registry";
export {
  registerCellRenderer,
  registerColumns,
  transformColumns,
  registerRowAction,
  registerBulkAction,
  resolvePluginColumns,
  getPluginRowActions,
  getPluginBulkActions,
  clearDataTablePlugins,
} from "./plugin-registry";
export type {
  DataTableTarget,
  DataTableContext,
  ColumnProvider,
  ColumnTransform,
} from "./plugin-registry";
export type {
  NextlyColumn,
  NextlyFieldType,
  NextlyFieldSchema,
  CellContext,
  CellRenderer,
  CellRendererDefinition,
  RowAction,
  BulkAction,
  DataTableSlots,
} from "./types";
