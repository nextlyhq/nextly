/**
 * What a change to a plugin's settings records and announces.
 *
 * A plugin's settings hold credentials — a provider's client secret, a
 * payment webhook key — so a change to them is a change the install must be
 * able to account for afterwards, exactly as an email provider's is. And a
 * plugin caching a value it read from its settings needs to hear that the
 * value moved, whichever path moved it.
 *
 * **Names, never values**, as every settings entry: the record says which
 * top-level keys changed and carries nothing from any of them.
 *
 * @module domains/plugins/settings-activity
 * @since 1.0.0
 */

import type { RequestActor } from "../../auth/request-actor";
import { safeEmit } from "../../events/domain-events";
import { PLUGIN_SETTINGS_CHANGED_EVENT } from "../../events/event-names";
import { getNextlyLogger } from "../../observability/logger";
import { recordSettingsActivity } from "../audit/record-settings-activity";

/**
 * The activity-log `collection` plugin settings changes are filed under.
 *
 * `settings`, because that is the resource the routes authorize them with,
 * and the feed shows a settings namespace to whoever `read-{namespace}`
 * admits: `read-settings`. The settings route also admits `manage-settings`,
 * so a role granted only that can change plugin settings without seeing this
 * trail; grant `read-settings` beside it to see both. The name is
 * reserved for collections and singles, so no content can share it.
 */
export const PLUGIN_SETTINGS_ACTIVITY_COLLECTION = "settings";

/** The payload of {@link PLUGIN_SETTINGS_CHANGED_EVENT}. */
export interface PluginSettingsChangedPayload {
  /** The plugin whose settings changed. */
  plugin: string;
  /** The top-level keys whose stored value changed. Never values. */
  changedKeys: string[];
}

/**
 * Record and announce one committed change to a plugin's settings.
 *
 * Runs after the write has committed, and never throws: the change has
 * happened, and reporting it as failed because the trail could not be
 * written would invite a retry of something that needs none. A failed record
 * is logged instead, so a trail that stops being written is visible.
 *
 * A change that moved nothing records and announces nothing.
 */
export async function announcePluginSettingsChange(input: {
  plugin: string;
  changedKeys: string[];
  /** Who made the change; a plugin's own write has none to record. */
  actor?: RequestActor | null;
}): Promise<void> {
  if (input.changedKeys.length === 0) return;
  try {
    await recordSettingsActivity({
      action: "update",
      collection: PLUGIN_SETTINGS_ACTIVITY_COLLECTION,
      entityId: input.plugin,
      entityTitle: input.plugin,
      changedFields: input.changedKeys,
      metadata: { plugin: input.plugin },
      actor: input.actor,
    });
  } catch (error) {
    getNextlyLogger().warn({
      kind: "plugin-settings-activity-failed",
      plugin: input.plugin,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const payload: PluginSettingsChangedPayload = {
    plugin: input.plugin,
    changedKeys: [...input.changedKeys],
  };
  safeEmit(PLUGIN_SETTINGS_CHANGED_EVENT, payload);
}
