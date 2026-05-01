import type * as React from "react";

/**
 * Column definition for ResponsiveTable
 *
 * Provides type-safe column definitions with proper type narrowing for render functions.
 *
 * @template T - The data type of items in the table
 * @template K - The specific key from T (defaults to any key of T)
 *
 * @example
 * ```tsx
 * interface User {
 *   id: string;
 *   name: string;
 *   age: number;
 * }
 *
 * // Type-safe column definition with proper inference
 * const columns: Column<User>[] = [
 *   {
 *     key: "name",
 *     label: "Name",
 *     // value is inferred as string, not string | number
 *     render: (value, user) => <strong>{value}</strong>
 *   },
 *   {
 *     key: "age",
 *     label: "Age",
 *     // value is inferred as number, not string | number
 *     render: (value) => `${value} years old`
 *   }
 * ];
 * ```
 */
export type Column<T, K extends keyof T = keyof T> = {
  /** Unique key for the column (must match a property in T) */
  key: K;
  /** Display label for the column header */
  label: React.ReactNode;
  /** Optional custom renderer for cell content with type-safe value */
  render?: (value: T[K], item: T) => React.ReactNode;
  /** Hide column on mobile card view (optional, default: false) */
  hideOnMobile?: boolean;
  /** Hide the label on mobile card view (optional, default: false) */
  hideLabelOnMobile?: boolean;
  /** Optional custom className for the table header cell */
  headerClassName?: string;
  /** Optional custom className for the table body cell */
  cellClassName?: string;
};

/**
 * Props for ResponsiveTable component
 *
 * @template T - The data type of items in the table, must have an 'id' property
 */
export type ResponsiveTableProps<T extends { id: string }> = {
  /** Array of data items to display */
  data: T[];
  /** Array of column definitions */
  columns: Column<T>[];
  /** Optional callback when a row/card is clicked */
  onRowClick?: (item: T) => void;
  /** Optional custom renderer for mobile card view */
  renderMobileCard?: (item: T, columns: Column<T>[]) => React.ReactNode;
  /** Optional custom className for the container */
  className?: string;
  /** Optional empty state message */
  emptyMessage?: string;
  /** Optional ARIA label for the table (improves screen reader experience) */
  ariaLabel?: string;
  /** Optional custom className for the internal desktop table wrapper */
  tableWrapperClassName?: string;
  /** Optional footer content rendered inside the table card (e.g. Pagination) */
  footer?: React.ReactNode;
};

/**
 * Ref type for ResponsiveTable component
 */
export type ResponsiveTableRef = HTMLDivElement;
