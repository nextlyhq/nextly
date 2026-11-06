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
 * Refuse one declared type, naming the plugin and the type: malformed, one of
 * core's, outside the plugin's own namespace (`<admin slug>.`), or one the
 * plugin already declared (`seen`).
 */
function assertDeclarableEventType(
  pluginName: string,
  type: unknown,
  seen: ReadonlySet<string>
): asserts type is string {
  const context = { plugin: pluginName, type };
  if (
    typeof type !== "string" ||
    type.length > EVENT_TYPE_MAX_LENGTH ||
    !EVENT_TYPE_SHAPE.test(type)
  ) {
    throw resolutionError(
      "plugin-webhook-event-malformed",
      `Plugin "${pluginName}" declares the webhook event type "${String(type)}", which must be lower-case segments separated by dots, at most ${EVENT_TYPE_MAX_LENGTH} characters.`,
      context
    );
  }
  if (CORE_TYPES.has(type)) {
    throw resolutionError(
      "plugin-webhook-event-core",
      `Plugin "${pluginName}" declares the webhook event type "${type}", which is one of core's.`,
      context
    );
  }
  if (!isInPluginNamespace(pluginName, type)) {
    const prefix = `${pluginAdminSlug(pluginName)}.`;
    throw resolutionError(
      "plugin-webhook-event-outside-namespace",
      `Plugin "${pluginName}" declares the webhook event type "${type}", which must start with "${prefix}".`,
      { ...context, expectedPrefix: prefix }
    );
  }
  if (seen.has(type)) {
    throw resolutionError(
      "plugin-webhook-event-duplicate",
      `Plugin "${pluginName}" declares the webhook event type "${type}" more than once.`,
      context
    );
  }
}

/**
 * Refuse a declared type's `label` or `description` that is not a string. A
 * plugin written in JavaScript has no compiler to stop one, and the list is
 * sent to the admin as it is published: a number or an object breaks the
 * answer's shape, and a value JSON cannot hold fails the request.
 */
function assertEventTypeText(
  pluginName: string,
  declared: { type: string; label?: unknown; description?: unknown }
): void {
  for (const field of ["label", "description"] as const) {
    const value = declared[field];
    if (value !== undefined && typeof value !== "string") {
      throw resolutionError(
        "plugin-webhook-event-text",
        `Plugin "${pluginName}" declares the webhook event type "${declared.type}" with a ${field} that is not text.`,
        { plugin: pluginName, type: declared.type, field }
      );
    }
  }
}

/**
 * Every enabled plugin's declared webhook event types, each checked by
 * {@link assertDeclarableEventType}. A disabled plugin is skipped, as the
 * other declarations are: it runs nothing, so it has nothing to deliver and
 * nothing to refuse.
 */
export function collectPluginWebhookEventTypes(
  plugins: readonly PluginDefinition[]
): WebhookEventTypeEntry[] {
  const collected: WebhookEventTypeEntry[] = [];
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    for (const declared of plugin.contributes?.webhookEvents ?? []) {
      assertDeclarableEventType(plugin.name, declared.type, seen);
      assertEventTypeText(plugin.name, declared);
      seen.add(declared.type);
      collected.push({
        type: declared.type,
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

/**
 * Where publication goes while a dev reload holds it: the reload's own stage,
 * or nowhere when no reload is running.
 */
let stage: { entries?: readonly WebhookEventTypeEntry[] } | null = null;

/** Publish the checked plugin types, for every reader of the list. */
export function publishWebhookEventTypes(
  entries: readonly WebhookEventTypeEntry[]
): void {
  if (stage !== null) {
    stage.entries = entries;
    return;
  }
  published = entries;
}

/**
 * Hold publication for the length of a dev reload, as the kinds of signed-in
 * person are held.
 *
 * Reading the reloaded config publishes its types long before the reload
 * knows whether it will land, and requests keep being served meanwhile. Held,
 * they wait on the stage: subscriptions go on being judged against the types
 * in force until `commit` installs the new ones, and `abandon` drops them, so
 * an endpoint is never let subscribe to a type from a config the process has
 * not accepted. Each settles once; whichever comes second does nothing.
 */
export function stageWebhookEventTypes(): {
  commit: () => void;
  abandon: () => void;
} {
  const held: { entries?: readonly WebhookEventTypeEntry[] } = {};
  stage = held;
  let settled = false;
  const settle = (install: boolean): void => {
    if (settled) return;
    settled = true;
    if (stage === held) stage = null;
    if (install && held.entries !== undefined) published = held.entries;
  };
  return { commit: () => settle(true), abandon: () => settle(false) };
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
