import {
  CATALOG_VERSION,
  DISTINCT_ID_PATTERNS,
  SITE_BASE_PROPERTIES,
  SITE_NOTICE_VERSION,
  TOOLS_BASE_PROPERTIES,
  TOOLS_NOTICE_VERSION,
  TRANSPORT_PROPERTIES,
  USAGE_EVENTS,
  type EventSpec,
  type PropertySpec,
} from "./catalog.js";

// The catalog as plain data, for readers that are not this package's code:
// the docs' telemetry page, generated from it and checked against it, and the
// ingest address, which drops any event the catalog does not list. Built from
// the same constants the types and the sender use, so there is one list.

export interface BasePropertiesData {
  required: Record<string, PropertySpec>;
  optional: Record<string, PropertySpec>;
}

export interface UsageCatalogData {
  catalog_version: number;
  notice_versions: { tools: number; site: number };
  /** The id each source's events are sent under: a machine's or a site's. */
  distinct_id: { tools: { pattern: string }; site: { pattern: string } };
  /** Added to every event by the sender; PostHog reads them as flags. */
  transport_properties: Record<string, boolean>;
  base_properties: { tools: BasePropertiesData; site: BasePropertiesData };
  events: Record<string, EventSpec>;
}

/** A deep, plain copy, so a reader cannot change the catalog in place. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function usageCatalogData(): UsageCatalogData {
  return plain({
    catalog_version: CATALOG_VERSION,
    notice_versions: { tools: TOOLS_NOTICE_VERSION, site: SITE_NOTICE_VERSION },
    distinct_id: {
      tools: { pattern: DISTINCT_ID_PATTERNS.tools },
      site: { pattern: DISTINCT_ID_PATTERNS.site },
    },
    transport_properties: { ...TRANSPORT_PROPERTIES },
    base_properties: {
      tools: TOOLS_BASE_PROPERTIES,
      site: SITE_BASE_PROPERTIES,
    },
    events: USAGE_EVENTS,
  });
}
