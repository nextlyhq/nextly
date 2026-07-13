/**
 * Unified DataTable public surface.
 * @module components/ui/table/data-table
 */

export { DataTable } from "./DataTable";
export type { DataTableProps } from "./DataTable";
export {
  defineCellRenderer,
  getCellRenderer,
  getRegisteredCellTypes,
  resolveCellRenderer,
  textRenderer,
} from "./cell-registry";
export type {
  NextlyColumn,
  NextlyFieldType,
  NextlyFieldSchema,
  CellContext,
  CellRenderer,
  CellRendererDefinition,
  RowAction,
  BulkAction,
  RowClick,
  DataTableSlots,
} from "./types";
