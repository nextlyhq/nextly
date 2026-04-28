import type { TableParams } from "@revnixhq/ui";

/**
 * Configuration options for building query strings
 */
export interface BuildQueryOptions {
  /**
   * Field mapping from frontend field names to backend field names
   * @example { roleName: 'name', created: 'createdAt' }
   */
  fieldMapping?: Record<string, string>;

  /**
   * List of valid backend sort fields
   * Only these fields will be included in sortBy parameter
   */
  validSortFields?: string[];

  /**
   * Whether to include filters as JSON string in query
   * @default false
   */
  includeFilters?: boolean;

  /**
   * Whether to include populate parameter for relational expansions
   * @default false
   */
  includePopulate?: boolean;
}

/**
 * Build URL query string from table parameters
 *
 * Handles pagination, search, sorting, filters, and populate parameters.
 * Converts 0-based page numbers to 1-based for backend compatibility.
 *
 * @param params - Table parameters from frontend
 * @param options - Configuration options for query building
 * @returns Query string (without leading '?')
 *
 * @example
 * ```ts
 * const query = buildQuery(params, {
 *   fieldMapping: { roleName: 'name' },
 *   validSortFields: ['name', 'level'],
 *   includeFilters: true,
 * });
 * // Returns: "page=1&pageSize=10&sortBy=name&sortOrder=asc"
 * ```
 */
export const buildQuery = (
  params: TableParams,
  options: BuildQueryOptions = {}
): string => {
  const {
    fieldMapping = {},
    validSortFields,
    includeFilters = false,
    includePopulate = false,
  } = options;

  const query = new URLSearchParams();
  const { page, pageSize } = params.pagination;
  const search = params.filters?.search?.trim();

  // Always send pageSize to ensure backend gets the correct value
  if (pageSize) query.set("pageSize", String(pageSize));

  // Handle search — force page=1 when searching
  if (search) {
    query.set("page", "1"); // Always reset to first page when searching
    query.set("search", search);
  } else if (page !== undefined && page >= 0) {
    // Convert from 0-based to 1-based page numbering for backend
    query.set("page", String(page + 1));
  }

  // Handle sorting
  const sort = params.sorting?.[0];
  if (sort) {
    // Map frontend field name to backend field name
    const backendField = fieldMapping[sort.field] || sort.field;

    // Only include sort if no validSortFields specified, or field is in the list
    if (!validSortFields || validSortFields.includes(backendField)) {
      query.set("sortBy", backendField);
      query.set("sortOrder", sort.direction);
    }
  }

  // Forward filters as a JSON string if requested
  if (includeFilters) {
    const rawFilters = params.filters?.filters;
    if (rawFilters && Object.keys(rawFilters).length > 0) {
      try {
        query.set("filters", JSON.stringify(rawFilters));
      } catch (error) {
        // Log serialization errors in development but continue without filters
        if (process.env.NODE_ENV === "development") {
          console.error("Failed to serialize filters:", error);
        }
        // Don't include malformed filters in request
      }
    }
  }

  // Forward populate parameter for relational expansions if requested
  if (includePopulate) {
    const populate: unknown =
      (params as unknown as Record<string, unknown>).populate ??
      (params.filters as Record<string, unknown> | undefined)?.populate;
    if (Array.isArray(populate) && populate.length > 0) {
      try {
        query.set("populate", JSON.stringify(populate));
      } catch (error) {
        // Log serialization errors in development but continue without populate
        if (process.env.NODE_ENV === "development") {
          console.error("Failed to serialize populate parameter:", error);
        }
      }
    } else if (typeof populate === "string" && populate) {
      query.set("populate", populate);
    }
  }

  return query.toString();
};
