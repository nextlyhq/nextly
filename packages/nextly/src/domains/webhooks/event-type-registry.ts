/**
 * Webhook domain — the one list of event types an endpoint may subscribe to:
 * core's, and every enabled plugin's `contributes.webhookEvents`.
 *
 * Collected and checked once, when plugins are resolved, and published here.
 * Every later question about event types reads this list: whether an endpoint
 * may subscribe to a type, and what the admin's webhook form offers. Two lists
 * kept apart drift, and the admin's own copy of core's list is how a type the
 * server accepted came to be one the form never offered.
 *
 * @module domains/webhooks/event-type-registry
 */
import type { PluginDefinition } from "../../plugins/plugin-context";
import {
  isInPluginNamespace,
  pluginAdminSlug,
} from "../../plugins/plugin-slug";
import { resolutionError } from "../../plugins/resolution-error";

import { WEBHOOK_EVENT_TYPES } from "./types";

/** One event type an endpoint may subscribe to, and who declares it. */
export interface WebhookEventTypeEntry {
  /** The type's id, e.g. `"entry.created"` or `"acme-shop.order.paid"`. */
  readonly type: string;
  /** `"core"`, or the name of the plugin that declares it. */
  readonly owner: string;
  readonly label?: string;
  readonly description?: string;
}

/**
 * The shape of an event type: lower-case segments of letters, digits, `_` and
 * `-`, at least two, separated by dots, and no longer than the delivery log's
 * event-type filter accepts.
 */
const EVENT_TYPE_SHAPE = /^[a-z0-9][a-z0-9_-]*(\.[a-z0-9][a-z0-9_-]*)+$/;
const EVENT_TYPE_MAX_LENGTH = 100;

const CORE_TYPES: ReadonlySet<string> = new Set(WEBHOOK_EVENT_TYPES);

/**
 * Every enabled plugin's declared webhook event types, checked.
 *
 * Refuses, naming the plugin and the type: a type outside the plugin's own
 * namespace (`<admin slug>.`), one of core's, one the plugin declares twice,
 * and one that is malformed. A disabled plugin is skipped, as the other
 * declarations are: it runs nothing, so it has nothing to deliver and nothing
 * to refuse.
 */
export function collectPluginWebhookEventTypes(
  plugins: readonly PluginDefinition[]
): WebhookEventTypeEntry[] {
  const collected: WebhookEventTypeEntry[] = [];
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    for (const declared of plugin.contributes?.webhookEvents ?? []) {
      const type = declared.type;
      const context = { plugin: plugin.name, type };
      if (
        typeof type !== "string" ||
        type.length > EVENT_TYPE_MAX_LENGTH ||
        !EVENT_TYPE_SHAPE.test(type)
      ) {
        throw resolutionError(
          "plugin-webhook-event-malformed",
          `Plugin "${plugin.name}" declares the webhook event type "${String(type)}", which must be lower-case segments separated by dots, at most ${EVENT_TYPE_MAX_LENGTH} characters.`,
          context
        );
      }
      if (CORE_TYPES.has(type)) {
        throw resolutionError(
          "plugin-webhook-event-core",
          `Plugin "${plugin.name}" declares the webhook event type "${type}", which is one of core's.`,
          context
        );
      }
      if (!isInPluginNamespace(plugin.name, type)) {
        const prefix = `${pluginAdminSlug(plugin.name)}.`;
        throw resolutionError(
          "plugin-webhook-event-outside-namespace",
          `Plugin "${plugin.name}" declares the webhook event type "${type}", which must start with "${prefix}".`,
          { ...context, expectedPrefix: prefix }
        );
      }
      if (seen.has(type)) {
        throw resolutionError(
          "plugin-webhook-event-duplicate",
          `Plugin "${plugin.name}" declares the webhook event type "${type}" more than once.`,
          context
        );
      }
      seen.add(type);
      collected.push({
        type,
        owner: plugin.name,
        ...(declared.label === undefined ? {} : { label: declared.label }),
        ...(declared.description === undefined
          ? {}
          : { description: declared.description }),
      });
    }
  }
  return collected;
}

/** The plugin types published at resolution; none before it runs. */
let published: readonly WebhookEventTypeEntry[] = [];

/** Publish the checked plugin types, for every reader of the list. */
export function publishWebhookEventTypes(
  entries: readonly WebhookEventTypeEntry[]
): void {
  published = entries;
}

/** Every type an endpoint may subscribe to: core's first, then plugins'. */
export function webhookEventTypes(): readonly WebhookEventTypeEntry[] {
  return [
    ...WEBHOOK_EVENT_TYPES.map(type => ({ type, owner: "core" })),
    ...published,
  ];
}

/** Whether an endpoint may subscribe to `type` now. */
export function isSubscribableEventType(type: string): boolean {
  return webhookEventTypes().some(entry => entry.type === type);
}
