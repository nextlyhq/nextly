/**
 * The durable plugin events' tables for each dialect.
 *
 * @module schemas/plugin-events
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

export {
  PLUGIN_EVENT_DELIVERIES_TABLE,
  PLUGIN_EVENTS_TABLE,
} from "./table-name";

/** The tables, keyed as `getCoreSchema` spreads them. */
export function pluginEventsTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyPluginEvents, nextlyPluginEventDeliveries } =
    loadedDialect(dialect).tables;
  return { nextlyPluginEvents, nextlyPluginEventDeliveries };
}
