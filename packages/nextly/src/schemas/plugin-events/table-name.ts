/**
 * The two tables durable plugin events live in: the events plugins record,
 * and one delivery of each to each subscriber. Their own outbox, apart from
 * the webhook one, so webhook fan-out and pruning never reach them.
 *
 * @module schemas/plugin-events/table-name
 */

export const PLUGIN_EVENTS_TABLE = "nextly_plugin_events";
export const PLUGIN_EVENT_DELIVERIES_TABLE = "nextly_plugin_event_deliveries";
