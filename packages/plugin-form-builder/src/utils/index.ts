/**
 * Form Builder Utilities
 *
 * Exports utility functions for form processing, validation, and evaluation.
 *
 * @module utils
 */

// Conditional logic evaluation
export {
  evaluateConditions,
  isValidComparisonOperator,
  getSupportedComparisonOperators,
  type ComparisonOperator,
} from "./evaluate-conditions";

// Zod schema generation and validation
export {
  generateZodSchema,
  transformFormData,
  validateFormData,
  getValidationErrors,
} from "./generate-schema";

// Export formats (CSV, JSON)
export {
  exportToCSV,
  exportToJSON,
  formatExportValue,
  downloadFile,
  generateExportFilename,
  exportAndDownload,
  type CSVExportOptions,
  type JSONExportOptions,
  type ExportedJSON,
} from "./export-formats";
