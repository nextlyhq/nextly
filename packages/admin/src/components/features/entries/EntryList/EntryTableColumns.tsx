"use client";

/**
 * Entry Table Columns Generator
 *
 * Dynamically generates TanStack React Table column definitions from collection
 * field schemas. Supports all field types with appropriate cell renderers and
 * configurable column widths, sorting, and visibility.
 *
 * @module components/entries/EntryList/EntryTableColumns
 * @see https://tanstack.com/table/v8/docs/api/core/column-def
 * @since 1.0.0
 */

import { Checkbox } from "@nextlyhq/ui";
import type { ColumnDef } from "@tanstack/react-table";
import type { FieldConfig, DataFieldConfig } from "nextly/config";

import type { NextlyColumn } from "@admin/components/ui/table/data-table";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";

import { EntryTableActions } from "./EntryTableActions";
import { EntryTableCell } from "./EntryTableCell";
import { TranslationCompletenessBadge } from "./TranslationCompletenessBadge";

// ============================================================================
// Types
// ============================================================================

/**
 * Data field configuration with guaranteed name property.
 * Used for fields that can be displayed as table columns.
 */
type NamedDataFieldConfig = DataFieldConfig & { name: string };

/**
 * Minimal collection information needed for column generation.
 * Compatible with DynamicCollectionRecord from nextly.
 */
export interface CollectionForColumns {
  /** Collection slug identifier */
  slug: string;
  /** Display label for the collection (usually plural) */
  label?: string;
  /** Field definitions for the collection */
  fields: FieldConfig[];
  /**
   * Whether this collection has the built-in Draft / Published lifecycle
   * enabled. Mirrors `defineCollection({ status: true })` and the matching
   * Schema Builder Advanced-tab toggle. Drives bulk Publish / Unpublish
   * actions in the table's bulk-action bar — those buttons only render
   * when this is true.
   */
  status?: boolean;
  /**
   * Whether this collection has multilingual content (i18n). When true, the table can render a
   * per-row translation-completeness column from each row's `_translations` map.
   */
  localized?: boolean;
  /** Admin UI configuration */
  admin?: {
    /** Default columns to display in list view */
    defaultColumns?: string[];
    /** Field to use as the document title */
    useAsTitle?: string;
  };
}

/**
 * Options for generating entry table columns.
 */
export interface GenerateColumnsOptions {
  /** Collection configuration with fields and admin settings */
  collection: CollectionForColumns;
  /** Callback when edit action is triggered */
  onEdit: (entryId: string) => void;
  /** Callback when delete action is triggered */
  onDelete: (entryId: string) => void;
  /** Whether to include selection column (default: true) */
  enableSelection?: boolean;
  /** Whether to include actions column (default: true) */
  enableActions?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Field types that support sorting in the table.
 */
const SORTABLE_FIELD_TYPES: readonly string[] = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "email",
  "checkbox",
];

/**
 * Default number of data columns to show when defaultColumns is not specified.
 */
const DEFAULT_COLUMN_COUNT = 4;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Determines if a field type supports sorting.
 *
 * @param field - Field configuration to check
 * @returns True if the field can be sorted
 */
function isSortableField(field: FieldConfig): boolean {
  return SORTABLE_FIELD_TYPES.includes(field.type);
}

/**
 * Calculates the appropriate column width based on field type.
 *
 * @param field - Field configuration
 * @returns Column width in pixels
 */
function getColumnSize(field: FieldConfig): number {
  const fieldType = field.type as string;
  switch (fieldType) {
    case "checkbox":
      return 80;
    case "date":
      return 140;
    case "email":
      return 200;
    case "select":
      return 150;
    case "radio":
      return 150;
    case "number":
      return 100;
    case "textarea":
    case "richText":
    case "code":
      return 300;
    case "relationship":
      return 180;
    case "upload":
      return 120;
    case "repeater":
      return 100;
    case "json":
      return 150;
    default:
      return 200;
  }
}

/**
 * Type guard to check if a field is a named data field (has a name property).
 *
 * @param field - Field configuration to check
 * @returns True if the field is a data field with a name
 */
function isDataField(field: FieldConfig): field is NamedDataFieldConfig {
  return "name" in field && typeof field.name === "string";
}

/**
 * Recursively gets all data fields from a list of fields, including nested ones.
 *
 * @param fields - Array of field configurations
 * @returns Array of named data fields
 */
function getAllDataFields(fields: FieldConfig[]): NamedDataFieldConfig[] {
  const dataFields: NamedDataFieldConfig[] = [];
  const excludedTypes = ["group", "relationship", "repeater", "component"];

  for (const field of fields) {
    // Only include direct data fields that are not complex/layout types
    if (isDataField(field) && !excludedTypes.includes(field.type)) {
      dataFields.push(field);
    }
  }

  return dataFields;
}

/**
 * Gets the default columns to display when admin.defaultColumns is not specified.
 * Returns the first N data fields plus updatedAt.
 *
 * @param fields - Array of field configurations
 * @returns Array of field names to display as columns
 */
function getDefaultColumns(fields: FieldConfig[]): string[] {
  // Filter to data fields only (exclude layout fields)
  const dataFields = getAllDataFields(fields)
    .slice(0, DEFAULT_COLUMN_COUNT)
    .map(f => f.name);

  // Always include title, slug, id, createdAt and updatedAt.
  // 07-admin-bugs-feedback, the user expects both timestamps visible
  // in the entries table without having to open the column toggler.
  // Updated alone is the "what changed last" signal but Created is the
  // "when did this exist" signal — both are first-class metadata.
  return [...dataFields, "title", "slug", "id", "createdAt", "updatedAt"];
}

/**
 * Gets all available column IDs for a collection.
 * Includes all data field names plus built-in columns (id, createdAt, updatedAt).
 *
 * @param collection - Collection configuration
 * @returns Array of all column IDs that can be displayed
 */
export function getAvailableColumns(
  collection: CollectionForColumns
): string[] {
  const dataFields = getAllDataFields(collection.fields).map(f => f.name);
  const useAsTitle = collection.admin?.useAsTitle;

  // These columns are always available as built-ins
  const builtInColumns = ["id", "title", "slug", "createdAt", "updatedAt"];

  // i18n M7: translation-completeness column, only for localized collections.
  if (collection.localized) {
    builtInColumns.push("translations");
  }

  if (useAsTitle && !builtInColumns.includes(useAsTitle)) {
    builtInColumns.push(useAsTitle);
  }

  // Add built-in columns and structural columns, then unique them
  return Array.from(
    new Set(["select", ...builtInColumns, ...dataFields, "actions"])
  );
}

/**
 * Gets the default visible columns for a collection.
 * Uses admin.defaultColumns if defined, otherwise auto-generates defaults.
 *
 * @param collection - Collection configuration
 * @returns Array of column IDs that should be visible by default
 */
export function getDefaultVisibleColumns(
  collection: CollectionForColumns
): string[] {
  // Always include structural columns
  const structural = ["select", "actions"];
  // Get data columns from config or auto-generate
  const dataColumns =
    collection.admin?.defaultColumns || getDefaultColumns(collection.fields);

  // Filter out the columns we want to explicitly position
  const coreColumns = ["id", "title", "slug", "updatedAt"];
  const useAsTitle = collection.admin?.useAsTitle;
  if (useAsTitle) coreColumns.push(useAsTitle);

  const otherColumns = dataColumns.filter(col => !coreColumns.includes(col));

  // Build the ordered data columns
  let orderedDataColumns: string[] = [];

  // 1. ID (Note: keep 'id' in availableColumns for the toggler, but skip pushing it to default visible columns)

  // 2. Title (either useAsTitle or 'title')
  if (useAsTitle && useAsTitle !== "id") {
    orderedDataColumns.push(useAsTitle);
  } else {
    orderedDataColumns.push("title");
  }

  // 3. Slug
  orderedDataColumns.push("slug");

  // 4. Description (if it's in the data columns and not used as title)
  if (dataColumns.includes("description") && useAsTitle !== "description") {
    orderedDataColumns.push("description");
  }

  orderedDataColumns.push("createdAt");
  orderedDataColumns.push("updatedAt");

  // 5. i18n M7: translation-completeness column for localized collections.
  if (collection.localized) {
    orderedDataColumns.push("translations");
  }

  // 6. Remaining data columns
  orderedDataColumns = [...orderedDataColumns, ...otherColumns];

  // Remove any duplicates, structural columns, and the ID column from default visibility
  const uniqueDataColumns = Array.from(new Set(orderedDataColumns)).filter(
    col => !structural.includes(col) && col !== "id"
  );

  return [
    structural[0], // "select"
    ...uniqueDataColumns,
    structural[1], // "actions"
  ];
}

/**
 * Finds a field configuration by name, handling nested fields in layout wrappers.
 *
 * @param fields - Array of field configurations
 * @param fieldName - Name of the field to find
 * @returns Field configuration or undefined if not found
 */
export function findFieldByName(
  fields: FieldConfig[],
  fieldName: string
): NamedDataFieldConfig | undefined {
  for (const field of fields) {
    // Direct match - only data fields have names
    if (isDataField(field) && field.name === fieldName) {
      return field;
    }

    // Check nested fields in array/group
    const fieldType = field.type as string;
    if (fieldType === "repeater" && "fields" in field) {
      const found = findFieldByName(field.fields as FieldConfig[], fieldName);
      if (found) return found;
    }

    if (field.type === "group" && "fields" in field) {
      const found = findFieldByName(field.fields as FieldConfig[], fieldName);
      if (found) return found;
    }
  }

  return undefined;
}

// ============================================================================
// Main Column Generator
// ============================================================================

/**
 * Generates TanStack React Table column definitions from collection schema.
 *
 * Creates columns for:
 * 1. Row selection (checkboxes for bulk operations)
 * 2. Data columns based on collection fields
 * 3. Actions column (edit, delete, duplicate)
 *
 * @param options - Column generation options
 * @returns Array of column definitions for TanStack Table
 *
 * @example
 * ```tsx
 * const columns = useMemo(
 *   () => generateEntryColumns({
 *     collection,
 *     onEdit: (id) => router.push(`/entries/${collection.slug}/${id}`),
 *     onDelete: (id) => deleteEntry(id),
 *   }),
 *   [collection, router, deleteEntry]
 * );
 * ```
 */
export function generateEntryColumns({
  collection,
  onEdit,
  onDelete,
  enableSelection = true,
  enableActions = true,
}: GenerateColumnsOptions): ColumnDef<Record<string, unknown>>[] {
  const columns: ColumnDef<Record<string, unknown>>[] = [];

  // -------------------------------------------------------------------------
  // Selection Column
  // -------------------------------------------------------------------------
  if (enableSelection) {
    columns.push({
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={value => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all rows"
          indeterminate={
            table.getIsSomePageRowsSelected() &&
            !table.getIsAllPageRowsSelected()
          }
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={value => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
      size: 40,
    });
  }

  // -------------------------------------------------------------------------
  // Data Columns
  // -------------------------------------------------------------------------

  // Define all available columns so they can be toggled via visibility state
  const availableColumns = getAvailableColumns(collection);

  // Identify which field should act as the primary title/navigation link
  const titleFieldName =
    collection.admin?.useAsTitle ||
    (availableColumns.includes("title")
      ? "title"
      : availableColumns.includes("name")
        ? "name"
        : availableColumns.includes("label")
          ? "label"
          : availableColumns.find(
              (col: string) =>
                !["select", "id", "actions", "createdAt", "updatedAt"].includes(
                  col
                )
            ));

  for (const columnName of availableColumns) {
    const field = findFieldByName(collection.fields, columnName);

    if (!field) {
      // i18n M7: translation-completeness column (localized collections only). Renders a compact
      // "n/total" badge summarising how many languages are translated for the row.
      if (columnName === "translations") {
        columns.push({
          id: "translations",
          accessorKey: "_translations",
          header: "Languages",
          cell: ({ row }) => (
            <TranslationCompletenessBadge
              translations={
                row.original._translations as
                  | Record<string, { translated: boolean; status?: string }>
                  | undefined
              }
            />
          ),
          size: 130,
          enableSorting: false,
        });
        continue;
      }

      // Handle special built-in columns (createdAt, updatedAt, id)
      if (columnName === "createdAt" || columnName === "updatedAt") {
        columns.push({
          id: columnName,
          accessorKey: columnName,
          header: columnName === "createdAt" ? "Created" : "Updated",
          cell: ({ getValue, row }) => {
            const value =
              (getValue() as string | undefined) ||
              ((columnName === "createdAt"
                ? row.original.created_at
                : row.original.updated_at) as string | undefined);
            if (!value) return <span className="text-muted-foreground">-</span>;
            return (
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                {formatDateWithAdminTimezone(
                  value,
                  {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZoneName: "short",
                  },
                  "-"
                )}
              </span>
            );
          },
          size: 190,
          enableSorting: true,
        });
        continue;
      }

      if (columnName === "id") {
        columns.push({
          id: "id",
          accessorKey: "id",
          header: "ID",
          cell: ({ getValue, row }) => {
            const value = getValue() as string;
            // Show truncated ID for UUIDs
            const displayValue =
              value.length > 8 ? `${value.slice(0, 8)}...` : value;

            if (titleFieldName === "id") {
              return (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    onEdit(row.original.id as string);
                  }}
                  className="font-mono text-xs text-foreground hover:underline transition-colors text-left w-fit cursor-pointer"
                  title={value}
                >
                  {displayValue}
                </button>
              );
            }
            return (
              <span
                className="font-mono text-xs text-muted-foreground"
                title={value}
              >
                {displayValue}
              </span>
            );
          },
          size: 100,
          enableSorting: false,
        });
        continue;
      }

      if (columnName === "title") {
        columns.push({
          id: "title",
          accessorKey: "title",
          header: "Title",
          cell: ({ getValue, row }) => {
            const value = getValue() as string | undefined;
            if (!value) return <span className="text-muted-foreground">-</span>;

            if (titleFieldName === "title") {
              return (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    onEdit(row.original.id as string);
                  }}
                  className="text-sm font-medium text-foreground hover:underline transition-colors text-left w-fit cursor-pointer"
                >
                  {value}
                </button>
              );
            }
            return <span className="text-sm text-foreground">{value}</span>;
          },
          size: 200,
          enableSorting: true,
        });
        continue;
      }

      if (columnName === "slug") {
        columns.push({
          id: "slug",
          accessorKey: "slug",
          header: "Slug",
          cell: ({ getValue }) => {
            const value = getValue() as string | undefined;
            if (!value) return <span className="text-muted-foreground">-</span>;
            return (
              <span className="font-mono text-sm text-foreground">{value}</span>
            );
          },
          size: 150,
          enableSorting: true,
        });
        continue;
      }

      // Unknown column name - skip
      continue;
    }

    // Create column for data field (field is guaranteed to be a named data field)
    columns.push({
      id: field.name,
      accessorKey: field.name,
      header: field.label || formatFieldName(field.name),
      cell: ({ row, getValue }) => (
        <EntryTableCell
          field={field}
          value={getValue()}
          entry={row.original}
          collectionSlug={collection.slug}
          isTitle={field.name === titleFieldName}
          onEdit={onEdit}
        />
      ),
      enableSorting: isSortableField(field),
      size: getColumnSize(field),
      meta: {
        fieldType: field.type,
        fieldConfig: field,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Actions Column
  // -------------------------------------------------------------------------
  if (enableActions) {
    columns.push({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <EntryTableActions
          entryId={row.original.id as string}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ),
      enableSorting: false,
      enableHiding: false,
      size: 80,
    });
  }

  return columns;
}

/**
 * Formats a field name into a human-readable label.
 * Converts camelCase and snake_case to Title Case.
 *
 * @param name - Field name to format
 * @returns Formatted label
 *
 * @example
 * formatFieldName('firstName') // 'First Name'
 * formatFieldName('created_at') // 'Created At'
 */
function formatFieldName(name: string): string {
  return (
    name
      // Handle camelCase
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      // Handle snake_case
      .replace(/_/g, " ")
      // Capitalize first letter of each word
      .replace(/\b\w/g, char => char.toUpperCase())
  );
}

// ============================================================================
// Unified DataTable column generator
// ============================================================================

/**
 * Resolves which column acts as the primary title / navigation link.
 */
export function getEntryTitleField(
  collection: CollectionForColumns
): string | undefined {
  // Resolve from ACTUAL schema fields. `getAvailableColumns` always injects a
  // synthetic "title" column, so testing it would always win and leave
  // collections without a real title field with an empty primary column.
  const fieldNames = getAllDataFields(collection.fields).map(
    field => field.name
  );

  return (
    collection.admin?.useAsTitle ||
    ["title", "name", "label"].find(name => fieldNames.includes(name)) ||
    fieldNames[0] ||
    "id"
  );
}

/**
 * Builds unified-DataTable columns from a collection schema.
 *
 * Produces `NextlyColumn` definitions for the built-in columns
 * (id/title/slug/createdAt/updatedAt) and every data field, reusing
 * `EntryTableCell` for field rendering so cell output is identical to the
 * legacy table. The select and actions columns are omitted — the DataTable
 * renders selection and the row-action menu itself. Column visibility is
 * applied by marking columns `hidden` from the passed visibility map.
 */
export function buildEntryColumns(
  collection: CollectionForColumns,
  columnVisibility?: Record<string, boolean>
): NextlyColumn<Record<string, unknown>>[] {
  const isHidden = (name: string) => columnVisibility?.[name] === false;

  const columnNames = getAvailableColumns(collection).filter(
    name => name !== "select" && name !== "actions"
  );

  const cols: NextlyColumn<Record<string, unknown>>[] = [];

  for (const columnName of columnNames) {
    const field = findFieldByName(collection.fields, columnName);
    const hidden = isHidden(columnName);

    if (!field) {
      if (columnName === "createdAt" || columnName === "updatedAt") {
        cols.push({
          name: columnName,
          header: columnName === "createdAt" ? "Created" : "Updated",
          sortable: true,
          hidden,
          cell: ({ value, row }) => {
            const raw =
              (value as string | undefined) ||
              ((columnName === "createdAt"
                ? row.created_at
                : row.updated_at) as string | undefined);
            if (!raw) return <span className="text-muted-foreground">-</span>;
            return (
              <span className="whitespace-nowrap text-sm text-muted-foreground">
                {formatDateWithAdminTimezone(
                  raw,
                  {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZoneName: "short",
                  },
                  "-"
                )}
              </span>
            );
          },
        });
        continue;
      }

      if (columnName === "id") {
        cols.push({
          name: "id",
          header: "ID",
          hidden,
          cell: ({ value }) => {
            const v = typeof value === "string" ? value : "";
            const display = v.length > 8 ? `${v.slice(0, 8)}...` : v;
            return (
              <span
                className="font-mono text-xs text-muted-foreground"
                title={v}
              >
                {display}
              </span>
            );
          },
        });
        continue;
      }

      if (columnName === "title") {
        cols.push({
          name: "title",
          header: "Title",
          sortable: true,
          hidden,
          cell: ({ value }) => {
            const v = typeof value === "string" ? value : "";
            if (!v) return <span className="text-muted-foreground">-</span>;
            return <span className="text-sm text-foreground">{v}</span>;
          },
        });
        continue;
      }

      if (columnName === "slug") {
        cols.push({
          name: "slug",
          header: "Slug",
          sortable: true,
          hidden,
          cell: ({ value }) => {
            const v = typeof value === "string" ? value : "";
            if (!v) return <span className="text-muted-foreground">-</span>;
            return (
              <span className="font-mono text-sm text-foreground">{v}</span>
            );
          },
        });
        continue;
      }

      continue;
    }

    // Data field — reuse EntryTableCell so field rendering stays identical.
    cols.push({
      name: field.name,
      header: field.label || formatFieldName(field.name),
      sortable: isSortableField(field),
      hidden,
      fieldType: field.type,
      align: field.type === "checkbox" ? "center" : undefined,
      cell: ({ value, row }) => (
        <EntryTableCell
          field={field}
          value={value}
          entry={row}
          collectionSlug={collection.slug}
        />
      ),
    });
  }

  return cols;
}

// ============================================================================
// Type Extensions for TanStack Table
// ============================================================================

declare module "@tanstack/react-table" {
  // Reason: TData is required by the generic interface signature for module
  // augmentation but is not referenced in the custom meta properties below.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    /** The field type for custom rendering */
    fieldType?: string;
    /** Full field configuration for advanced rendering */
    fieldConfig?: FieldConfig;
  }
}
