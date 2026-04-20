/**
 * Export Formats Utilities
 *
 * Pure utility functions for exporting form submissions to CSV and JSON formats.
 * These functions generate formatted strings that can be used for file downloads
 * or API responses.
 *
 * @module utils/export-formats
 * @since 0.1.0
 */

import type { SubmissionDocument, FormDocument, FormField } from "../types";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for CSV export.
 */
export interface CSVExportOptions {
  /**
   * Whether to include metadata columns (_id, _status, _submittedAt, etc.).
   * @default true
   */
  includeMetadata?: boolean;

  /**
   * Delimiter character for CSV.
   * @default ","
   */
  delimiter?: string;

  /**
   * Whether to include UTF-8 BOM for Excel compatibility.
   * @default true
   */
  includeBOM?: boolean;

  /**
   * Date format for timestamps.
   * @default "iso" (ISO 8601)
   */
  dateFormat?: "iso" | "locale";
}

/**
 * Options for JSON export.
 */
export interface JSONExportOptions {
  /**
   * Whether to include metadata in each submission.
   * @default true
   */
  includeMetadata?: boolean;

  /**
   * Whether to include form definition in the export.
   * @default true
   */
  includeFormDefinition?: boolean;

  /**
   * Number of spaces for indentation (0 for minified).
   * @default 2
   */
  indent?: number;
}

/**
 * Exported JSON structure.
 */
export interface ExportedJSON {
  /** Export metadata */
  exportedAt: string;

  /** Form information (if includeFormDefinition is true) */
  form?: {
    id: string;
    name: string;
    slug: string;
    fields: Array<{
      name: string;
      label: string;
      type: string;
    }>;
  };

  /** Total number of submissions in export */
  totalSubmissions: number;

  /** Array of submission data */
  submissions: Array<Record<string, unknown>>;
}

// ============================================================================
// Constants
// ============================================================================

/** Metadata column names with underscore prefix */
const METADATA_COLUMNS = [
  "_id",
  "_status",
  "_submittedAt",
  "_ipAddress",
  "_userAgent",
] as const;

/** UTF-8 BOM character sequence */
const UTF8_BOM = "\uFEFF";

// ============================================================================
// Value Formatting Helpers
// ============================================================================

/**
 * Format a field value for export based on field type.
 *
 * @param value - The raw value from submission data
 * @param field - The field definition (optional, for type-specific formatting)
 * @returns Formatted string representation of the value
 *
 * @example
 * ```typescript
 * formatExportValue(true, { type: 'checkbox' }); // "Yes"
 * formatExportValue(['a', 'b'], { type: 'select' }); // "a, b"
 * formatExportValue(new Date(), { type: 'date' }); // "2024-01-15"
 * ```
 */
export function formatExportValue(value: unknown, field?: FormField): string {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return "";
  }

  // Type-specific formatting when field definition is available
  if (field) {
    switch (field.type) {
      case "checkbox":
        return value ? "Yes" : "No";

      case "select":
        if (Array.isArray(value)) {
          return value.join(", ");
        }
        return String(value);

      case "file":
        if (Array.isArray(value)) {
          // File URLs or IDs
          return value.map(v => String(v)).join(", ");
        }
        return String(value);

      case "date":
        if (value instanceof Date) {
          return value.toISOString().split("T")[0];
        }
        if (typeof value === "string") {
          // Already a date string, return as-is or normalize
          const parsed = new Date(value);
          if (!isNaN(parsed.getTime())) {
            return parsed.toISOString().split("T")[0];
          }
        }
        return String(value);

      case "time":
        return String(value);

      case "hidden":
        return String(value);

      default:
        // text, email, phone, url, textarea, number, radio
        break;
    }
  }

  // Generic formatting for values without field definition
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

/**
 * Format a date for export.
 *
 * @param date - Date value (Date object or string)
 * @param format - Output format ("iso" or "locale")
 * @returns Formatted date string
 */
function formatDate(
  date: Date | string | undefined,
  format: "iso" | "locale" = "iso"
): string {
  if (!date) return "";

  const d = typeof date === "string" ? new Date(date) : date;

  if (isNaN(d.getTime())) {
    return "";
  }

  return format === "iso" ? d.toISOString() : d.toLocaleString();
}

// ============================================================================
// CSV Export
// ============================================================================

/**
 * Escape a value for CSV format (RFC 4180 compliant).
 *
 * Rules:
 * - Fields containing comma, double-quote, or newline must be quoted
 * - Double-quotes within fields must be escaped with another double-quote
 *
 * @param value - The value to escape
 * @param delimiter - The delimiter being used
 * @returns Properly escaped CSV value
 */
function escapeCSVValue(value: string, delimiter: string = ","): string {
  // Check if quoting is needed
  const needsQuoting =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r");

  if (!needsQuoting) {
    return value;
  }

  // Escape double quotes by doubling them
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Export submissions to CSV format.
 *
 * Generates an RFC 4180 compliant CSV string with:
 * - Form field values as columns (in form definition order)
 * - Optional metadata columns at the end (_id, _status, _submittedAt, etc.)
 * - Proper escaping of special characters
 * - Optional UTF-8 BOM for Excel compatibility
 *
 * @param submissions - Array of submission documents to export
 * @param form - Form document containing field definitions
 * @param options - Export options
 * @returns CSV formatted string
 *
 * @example
 * ```typescript
 * const csv = exportToCSV(submissions, form, {
 *   includeMetadata: true,
 *   includeBOM: true,
 * });
 *
 * // Download in browser
 * downloadFile(csv, 'submissions.csv', 'text/csv;charset=utf-8');
 * ```
 */
export function exportToCSV(
  submissions: SubmissionDocument[],
  form: FormDocument,
  options: CSVExportOptions = {}
): string {
  const {
    includeMetadata = true,
    delimiter = ",",
    includeBOM = true,
    dateFormat = "iso",
  } = options;

  const exportableFields = form.fields;

  // Build header row
  const headers: string[] = [];

  // Form field headers (using labels)
  for (const field of exportableFields) {
    headers.push(field.label);
  }

  // Metadata headers
  if (includeMetadata) {
    headers.push("ID", "Status", "Submitted At", "IP Address", "User Agent");
  }

  // Build data rows
  const rows: string[][] = [];

  for (const submission of submissions) {
    const row: string[] = [];
    const data = submission.data as Record<string, unknown>;

    // Form field values
    for (const field of exportableFields) {
      const value = data[field.name];
      const formatted = formatExportValue(value, field);
      row.push(escapeCSVValue(formatted, delimiter));
    }

    // Metadata values
    if (includeMetadata) {
      row.push(escapeCSVValue(submission.id, delimiter));
      row.push(escapeCSVValue(submission.status, delimiter));
      row.push(
        escapeCSVValue(
          formatDate(submission.submittedAt, dateFormat),
          delimiter
        )
      );
      row.push(escapeCSVValue(submission.ipAddress || "", delimiter));
      row.push(escapeCSVValue(submission.userAgent || "", delimiter));
    }

    rows.push(row);
  }

  // Escape headers
  const escapedHeaders = headers.map(h => escapeCSVValue(h, delimiter));

  // Build CSV string
  const lines = [
    escapedHeaders.join(delimiter),
    ...rows.map(row => row.join(delimiter)),
  ];

  // Use CRLF line endings for maximum compatibility
  const csvContent = lines.join("\r\n");

  // Prepend BOM if requested
  return includeBOM ? UTF8_BOM + csvContent : csvContent;
}

// ============================================================================
// JSON Export
// ============================================================================

/**
 * Export submissions to JSON format.
 *
 * Generates a structured JSON export with:
 * - Export metadata (timestamp)
 * - Optional form definition
 * - Array of submissions with field values
 * - Optional submission metadata (_id, _status, etc.)
 *
 * @param submissions - Array of submission documents to export
 * @param form - Form document containing field definitions
 * @param options - Export options
 * @returns JSON formatted string
 *
 * @example
 * ```typescript
 * const json = exportToJSON(submissions, form, {
 *   includeMetadata: true,
 *   includeFormDefinition: true,
 *   indent: 2,
 * });
 *
 * // Download in browser
 * downloadFile(json, 'submissions.json', 'application/json');
 * ```
 */
export function exportToJSON(
  submissions: SubmissionDocument[],
  form: FormDocument,
  options: JSONExportOptions = {}
): string {
  const {
    includeMetadata = true,
    includeFormDefinition = true,
    indent = 2,
  } = options;

  const exportableFields = form.fields;

  // Build form definition
  const formDefinition = includeFormDefinition
    ? {
        id: form.id,
        name: form.name,
        slug: form.slug,
        fields: exportableFields.map(f => ({
          name: f.name,
          label: f.label,
          type: f.type,
        })),
      }
    : undefined;

  // Build submission data
  const exportedSubmissions = submissions.map(submission => {
    const data = submission.data as Record<string, unknown>;

    // Build field data object with labels as keys for readability
    const fieldData: Record<string, unknown> = {};

    for (const field of exportableFields) {
      const value = data[field.name];
      // Use field name as key (consistent with submission data)
      fieldData[field.name] = value;
    }

    // Add metadata if requested
    if (includeMetadata) {
      return {
        ...fieldData,
        _metadata: {
          id: submission.id,
          status: submission.status,
          submittedAt: submission.submittedAt,
          ipAddress: submission.ipAddress || null,
          userAgent: submission.userAgent || null,
          createdAt: submission.createdAt,
          updatedAt: submission.updatedAt,
        },
      };
    }

    return fieldData;
  });

  // Build export object
  const exportData: ExportedJSON = {
    exportedAt: new Date().toISOString(),
    totalSubmissions: submissions.length,
    submissions: exportedSubmissions,
  };

  // Add form definition if requested
  if (formDefinition) {
    exportData.form = formDefinition;
  }

  return JSON.stringify(exportData, null, indent);
}

// ============================================================================
// Browser Download Helper
// ============================================================================

/**
 * Trigger a file download in the browser.
 *
 * Creates a Blob from the content and triggers a download using a temporary
 * anchor element. This function is browser-only and will throw in Node.js.
 *
 * @param content - File content as string
 * @param filename - Name for the downloaded file
 * @param mimeType - MIME type of the file
 *
 * @example
 * ```typescript
 * const csv = exportToCSV(submissions, form);
 * downloadFile(csv, 'contact-form-submissions.csv', 'text/csv;charset=utf-8');
 *
 * const json = exportToJSON(submissions, form);
 * downloadFile(json, 'submissions.json', 'application/json');
 * ```
 */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string
): void {
  // Check for browser environment
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("downloadFile is only available in browser environments");
  }

  // Create blob
  const blob = new Blob([content], { type: mimeType });

  // Create download URL
  const url = URL.createObjectURL(blob);

  // Create temporary anchor element
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;

  // Trigger download
  document.body.appendChild(link);
  link.click();

  // Cleanup
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generate a filename for export.
 *
 * Creates a filename with form slug and current timestamp.
 *
 * @param formSlug - The form's slug
 * @param format - Export format ('csv' or 'json')
 * @returns Generated filename
 *
 * @example
 * ```typescript
 * generateExportFilename('contact-form', 'csv');
 * // Returns: "contact-form-submissions-2024-01-15.csv"
 * ```
 */
export function generateExportFilename(
  formSlug: string,
  format: "csv" | "json"
): string {
  const date = new Date().toISOString().split("T")[0];
  return `${formSlug}-submissions-${date}.${format}`;
}

// ============================================================================
// Convenience Export Functions
// ============================================================================

/**
 * Export submissions and trigger browser download.
 *
 * Convenience function that combines export and download in one call.
 * Browser-only.
 *
 * @param submissions - Array of submission documents
 * @param form - Form document
 * @param format - Export format ('csv' or 'json')
 * @param options - Format-specific options
 *
 * @example
 * ```typescript
 * // In a React component
 * const handleExport = (format: 'csv' | 'json') => {
 *   exportAndDownload(submissions, form, format);
 * };
 * ```
 */
export function exportAndDownload(
  submissions: SubmissionDocument[],
  form: FormDocument,
  format: "csv" | "json",
  options?: CSVExportOptions | JSONExportOptions
): void {
  const filename = generateExportFilename(form.slug, format);

  if (format === "csv") {
    const content = exportToCSV(submissions, form, options as CSVExportOptions);
    downloadFile(content, filename, "text/csv;charset=utf-8");
  } else {
    const content = exportToJSON(
      submissions,
      form,
      options as JSONExportOptions
    );
    downloadFile(content, filename, "application/json");
  }
}
