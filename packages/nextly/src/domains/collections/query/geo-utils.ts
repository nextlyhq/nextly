/**
 * Geospatial Utilities
 *
 * Provides geospatial calculation utilities for point field queries.
 * Supports `near` and `within` operators for filtering entries by location.
 *
 * Uses the Haversine formula to calculate great-circle distance between
 * two points on Earth's surface. This is accurate to within 0.5% for
 * typical use cases.
 *
 * @see https://en.wikipedia.org/wiki/Haversine_formula
 *
 * @packageDocumentation
 */

// ============================================================================
// Constants
// ============================================================================

/** Earth's mean radius in meters */
const EARTH_RADIUS_METERS = 6_371_000;

/** Conversion factors to meters */
const UNIT_TO_METERS: Record<string, number> = {
  m: 1,
  km: 1000,
  mi: 1609.344,
  miles: 1609.344,
  ft: 0.3048,
  yd: 0.9144,
};

// ============================================================================
// Types
// ============================================================================

/**
 * Geographic point with longitude and latitude.
 *
 * Follows GeoJSON convention: `[longitude, latitude]` order.
 * - Longitude: -180 to 180 (East/West)
 * - Latitude: -90 to 90 (North/South)
 */
export interface Point {
  longitude: number;
  latitude: number;
}

/**
 * Point field value format.
 *
 * Stored as a tuple: `[longitude, latitude]`
 */
export type PointFieldValue = [number, number] | null | undefined;

/**
 * Parsed `near` query parameters.
 *
 * @example
 * ```typescript
 * // Query: ?where[location][near]=-74.006,40.7128,10000
 * const nearQuery: NearQuery = {
 *   point: { longitude: -74.006, latitude: 40.7128 },
 *   maxDistance: 10000, // 10km in meters
 *   minDistance: 0,
 * };
 * ```
 */
export interface NearQuery {
  /** Reference point to measure distance from */
  point: Point;
  /** Maximum distance in meters */
  maxDistance: number;
  /** Minimum distance in meters (optional) */
  minDistance: number;
}

/**
 * Parsed `within` query parameters.
 *
 * Supports circular regions (center point + radius).
 * Polygon support can be added in the future.
 */
export interface WithinQuery {
  /** Type of region */
  type: "circle";
  /** Center point for circle */
  center: Point;
  /** Radius in meters for circle */
  radius: number;
}

/**
 * Geo filter to be applied after database query.
 */
export interface GeoFilter {
  /** Field name (e.g., 'location', 'coordinates') */
  field: string;
  /** Geo operator */
  operator: "near" | "within";
  /** Parsed query value */
  value: NearQuery | WithinQuery;
}

/**
 * Result of geo filtering with optional distance information.
 */
export interface GeoFilterResult<T> {
  /** Filtered entries */
  entries: T[];
  /** Distance from reference point (for near queries), keyed by entry id */
  distances?: Map<string, number>;
}

// ============================================================================
// Distance Calculation
// ============================================================================

/**
 * Convert degrees to radians.
 */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculate the great-circle distance between two points using the Haversine formula.
 *
 * The Haversine formula calculates the shortest distance over the earth's surface,
 * giving an "as-the-crow-flies" distance between the points.
 *
 * @param from - Starting point
 * @param to - Ending point
 * @returns Distance in meters
 *
 * @example
 * ```typescript
 * // Distance from NYC to London
 * const nyc = { longitude: -74.006, latitude: 40.7128 };
 * const london = { longitude: -0.1276, latitude: 51.5074 };
 * const distance = calculateDistance(nyc, london);
 * // Returns: ~5570000 meters (5570 km)
 * ```
 */
export function calculateDistance(from: Point, to: Point): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLng = toRadians(to.longitude - from.longitude);

  // Haversine formula
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Convert a point field value to a Point object.
 *
 * @param value - Point field value as [longitude, latitude] tuple
 * @returns Point object or null if invalid
 */
export function pointFromValue(value: PointFieldValue): Point | null {
  if (!value || !Array.isArray(value) || value.length !== 2) {
    return null;
  }

  const [longitude, latitude] = value;

  if (typeof longitude !== "number" || typeof latitude !== "number") {
    return null;
  }

  if (isNaN(longitude) || isNaN(latitude)) {
    return null;
  }

  // Validate coordinate ranges
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return null;
  }

  return { longitude, latitude };
}

// ============================================================================
// Query Parsing
// ============================================================================

/**
 * Convert a distance value with optional unit to meters.
 *
 * @param value - Numeric value
 * @param unit - Unit string (m, km, mi, miles, ft, yd)
 * @returns Distance in meters
 */
function toMeters(value: number, unit: string = "m"): number {
  const factor = UNIT_TO_METERS[unit.toLowerCase()] ?? 1;
  return value * factor;
}

/**
 * Parse a `near` query parameter string.
 *
 * Format: `longitude,latitude,maxDistance[,minDistance][,unit]`
 *
 * @param value - Query parameter value
 * @returns Parsed NearQuery or null if invalid
 *
 * @example
 * ```typescript
 * // Basic: longitude, latitude, max distance in meters
 * parseNearQuery("-74.006,40.7128,10000");
 * // Returns: { point: { longitude: -74.006, latitude: 40.7128 }, maxDistance: 10000, minDistance: 0 }
 *
 * // With min distance
 * parseNearQuery("-74.006,40.7128,10000,1000");
 * // Returns: { point: { longitude: -74.006, latitude: 40.7128 }, maxDistance: 10000, minDistance: 1000 }
 *
 * // With unit
 * parseNearQuery("-74.006,40.7128,10,km");
 * // Returns: { point: { longitude: -74.006, latitude: 40.7128 }, maxDistance: 10000, minDistance: 0 }
 *
 * // With min distance and unit
 * parseNearQuery("-74.006,40.7128,10,1,km");
 * // Returns: { point: { longitude: -74.006, latitude: 40.7128 }, maxDistance: 10000, minDistance: 1000 }
 * ```
 */
export function parseNearQuery(value: string): NearQuery | null {
  if (!value || typeof value !== "string") {
    return null;
  }

  const parts = value.split(",").map(p => p.trim());

  // Minimum: longitude, latitude, maxDistance
  if (parts.length < 3) {
    return null;
  }

  const longitude = parseFloat(parts[0]);
  const latitude = parseFloat(parts[1]);

  // Validate coordinates
  if (isNaN(longitude) || isNaN(latitude)) {
    return null;
  }

  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return null;
  }

  // Parse distance values and optional unit
  let maxDistance: number;
  let minDistance = 0;
  let unit = "m";

  // Determine format based on parts length and content
  if (parts.length === 3) {
    // longitude,latitude,maxDistance
    maxDistance = parseFloat(parts[2]);
  } else if (parts.length === 4) {
    // Could be: lng,lat,max,unit OR lng,lat,max,min
    const fourthPart = parts[3];
    if (UNIT_TO_METERS[fourthPart.toLowerCase()]) {
      // It's a unit
      maxDistance = parseFloat(parts[2]);
      unit = fourthPart;
    } else {
      // It's minDistance
      maxDistance = parseFloat(parts[2]);
      minDistance = parseFloat(parts[3]);
    }
  } else if (parts.length >= 5) {
    // longitude,latitude,maxDistance,minDistance,unit
    maxDistance = parseFloat(parts[2]);
    minDistance = parseFloat(parts[3]);
    unit = parts[4];
  } else {
    return null;
  }

  // Validate distances
  if (isNaN(maxDistance) || maxDistance < 0) {
    return null;
  }

  if (isNaN(minDistance) || minDistance < 0) {
    minDistance = 0;
  }

  // Convert to meters
  maxDistance = toMeters(maxDistance, unit);
  minDistance = toMeters(minDistance, unit);

  return {
    point: { longitude, latitude },
    maxDistance,
    minDistance,
  };
}

/**
 * Parse a `within` query parameter.
 *
 * Currently supports circular regions.
 * Format: `longitude,latitude,radius[,unit]`
 *
 * @param value - Query parameter value
 * @returns Parsed WithinQuery or null if invalid
 *
 * @example
 * ```typescript
 * // Circle: center point and radius
 * parseWithinQuery("-74.006,40.7128,5000");
 * // Returns: { type: 'circle', center: { longitude: -74.006, latitude: 40.7128 }, radius: 5000 }
 *
 * // With unit
 * parseWithinQuery("-74.006,40.7128,5,km");
 * // Returns: { type: 'circle', center: { longitude: -74.006, latitude: 40.7128 }, radius: 5000 }
 * ```
 */
export function parseWithinQuery(value: string): WithinQuery | null {
  if (!value || typeof value !== "string") {
    return null;
  }

  const parts = value.split(",").map(p => p.trim());

  // Minimum: longitude, latitude, radius
  if (parts.length < 3) {
    return null;
  }

  const longitude = parseFloat(parts[0]);
  const latitude = parseFloat(parts[1]);
  let radius = parseFloat(parts[2]);
  const unit = parts[3] || "m";

  // Validate
  if (isNaN(longitude) || isNaN(latitude) || isNaN(radius)) {
    return null;
  }

  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return null;
  }

  if (radius <= 0) {
    return null;
  }

  // Convert to meters
  radius = toMeters(radius, unit);

  return {
    type: "circle",
    center: { longitude, latitude },
    radius,
  };
}

// ============================================================================
// Geo Filtering
// ============================================================================

/**
 * Check if a point satisfies a `near` query condition.
 *
 * @param point - Point to check
 * @param query - Near query parameters
 * @returns Object with match status and distance
 */
export function matchesNearQuery(
  point: Point,
  query: NearQuery
): { matches: boolean; distance: number } {
  const distance = calculateDistance(query.point, point);
  const matches =
    distance <= query.maxDistance && distance >= query.minDistance;
  return { matches, distance };
}

/**
 * Check if a point satisfies a `within` query condition.
 *
 * @param point - Point to check
 * @param query - Within query parameters
 * @returns Whether the point is within the region
 */
export function matchesWithinQuery(point: Point, query: WithinQuery): boolean {
  if (query.type === "circle") {
    const distance = calculateDistance(query.center, point);
    return distance <= query.radius;
  }

  // Future: Add polygon support
  return false;
}

/**
 * Apply geo filters to an array of entries.
 *
 * Filters entries based on geo query conditions and optionally calculates
 * distances for sorting purposes.
 *
 * @param entries - Array of entries to filter
 * @param filters - Array of geo filters to apply
 * @param options - Options for filtering
 * @returns Filtered entries with optional distance information
 *
 * @example
 * ```typescript
 * const entries = [
 *   { id: '1', location: [-74.006, 40.7128] },
 *   { id: '2', location: [-73.935, 40.730] },
 *   { id: '3', location: [-118.243, 34.052] }, // Far away
 * ];
 *
 * const filters: GeoFilter[] = [{
 *   field: 'location',
 *   operator: 'near',
 *   value: {
 *     point: { longitude: -74.0, latitude: 40.7 },
 *     maxDistance: 10000,
 *     minDistance: 0,
 *   },
 * }];
 *
 * const result = applyGeoFilters(entries, filters);
 * // Returns entries 1 and 2 (within 10km), excludes entry 3
 * ```
 */
export function applyGeoFilters<T extends Record<string, unknown>>(
  entries: T[],
  filters: GeoFilter[],
  options: { calculateDistances?: boolean; idField?: string } = {}
): GeoFilterResult<T> {
  const { calculateDistances = false, idField = "id" } = options;

  if (filters.length === 0) {
    return { entries };
  }

  const distances = calculateDistances ? new Map<string, number>() : undefined;

  const filteredEntries = entries.filter(entry => {
    // All geo filters must match (AND logic)
    return filters.every(filter => {
      const fieldValue = entry[filter.field] as PointFieldValue;
      const point = pointFromValue(fieldValue);

      if (!point) {
        // Entry doesn't have a valid point value - exclude it
        return false;
      }

      if (filter.operator === "near") {
        const nearQuery = filter.value as NearQuery;
        const { matches, distance } = matchesNearQuery(point, nearQuery);

        if (matches && distances) {
          const entryId = String(entry[idField] ?? "");
          if (entryId) {
            distances.set(entryId, distance);
          }
        }

        return matches;
      }

      if (filter.operator === "within") {
        const withinQuery = filter.value as WithinQuery;
        return matchesWithinQuery(point, withinQuery);
      }

      return true;
    });
  });

  return { entries: filteredEntries, distances };
}

/**
 * Sort entries by distance from a reference point.
 *
 * @param entries - Array of entries to sort
 * @param distances - Map of entry IDs to distances
 * @param idField - Field name for entry ID
 * @param order - Sort order ('asc' for nearest first, 'desc' for farthest first)
 * @returns Sorted entries
 */
export function sortByDistance<T extends Record<string, unknown>>(
  entries: T[],
  distances: Map<string, number>,
  idField: string = "id",
  order: "asc" | "desc" = "asc"
): T[] {
  return [...entries].sort((a, b) => {
    const distA = distances.get(String(a[idField] ?? "")) ?? Infinity;
    const distB = distances.get(String(b[idField] ?? "")) ?? Infinity;
    return order === "asc" ? distA - distB : distB - distA;
  });
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Check if a string value looks like a geo query.
 *
 * Used to quickly identify if a query parameter might be a geo query
 * before attempting full parsing.
 *
 * @param value - Value to check
 * @returns Whether the value looks like a geo query
 */
export function looksLikeGeoQuery(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  // Geo queries are comma-separated numbers (with optional unit at end)
  const parts = value.split(",");
  if (parts.length < 3) {
    return false;
  }

  // First two parts should be numbers (longitude, latitude)
  const lng = parseFloat(parts[0]);
  const lat = parseFloat(parts[1]);

  return !isNaN(lng) && !isNaN(lat);
}
