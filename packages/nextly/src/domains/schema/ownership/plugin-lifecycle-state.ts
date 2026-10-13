/**
 * Whether a plugin is installed, uninstalled or orphaned, recorded apart from
 * the tables it owns.
 *
 * The owner rows say what became of a plugin's TABLES, and a plugin that owns
 * none has no rows: its uninstall changed no state anywhere, so the next boot
 * initialised it again and the next install of a dependent took it for
 * installed whether its `onInstall` had ever run. So `nextly plugins install`
 * and `uninstall` record the plugin's own state too, as an event in the schema
 * ledger, which boot and the install check read beside the owner rows.
 *
 * One module for the write and every read, so they cannot disagree about
 * which event counts or what it says.
 *
 * @module domains/schema/ownership/plugin-lifecycle-state
 */
import { newestEvent } from "../events/newest-event";
import type {
  SchemaEventRow,
  SchemaEventsRepository,
} from "../events/schema-events-repository";

export type PluginLifecycleState = "installed" | "uninstalled" | "orphaned";

const STATES: ReadonlySet<string> = new Set<PluginLifecycleState>([
  "installed",
  "uninstalled",
  "orphaned",
]);

function isLifecycleState(value: unknown): value is PluginLifecycleState {
  return typeof value === "string" && STATES.has(value);
}

/**
 * The ledger key a plugin's lifecycle events are recorded under.
 *
 * One key per plugin is what orders them: the ledger stamps each new event
 * after the newest one under its key, so an install and the uninstall that
 * follows within a millisecond still read in that order. A namespace of its
 * own, so no migration file and no plugin module, whose keys are
 * `plugin:<name>/<module>`, can share it.
 */
export function pluginLifecycleKey(pluginName: string): string {
  return `plugin-lifecycle:${pluginName}`;
}

/** Record that a plugin's install or uninstall finished in this state. */
export async function recordPluginLifecycle(
  events: SchemaEventsRepository,
  pluginName: string,
  state: PluginLifecycleState
): Promise<void> {
  await events.insertEvent({
    eventType: "plugin_lifecycle",
    status: "applied",
    source: "cli-plugin-migrate",
    filename: pluginLifecycleKey(pluginName),
    scopeKind: "plugin",
    scopeSlug: pluginName,
    note: state,
    endedAt: new Date(),
  });
}

/**
 * Each plugin's newest recorded state, by name. A plugin with none was never
 * installed or uninstalled through the commands.
 */
export async function readPluginLifecycle(
  events: SchemaEventsRepository
): Promise<Map<string, PluginLifecycleState>> {
  const byPlugin = new Map<string, SchemaEventRow[]>();
  for (const row of await events.listPluginLifecycle()) {
    if (!row.scopeSlug) continue;
    const list = byPlugin.get(row.scopeSlug) ?? [];
    list.push(row);
    byPlugin.set(row.scopeSlug, list);
  }
  const states = new Map<string, PluginLifecycleState>();
  for (const [plugin, rows] of byPlugin) {
    const note = newestEvent(rows)?.note;
    // A state this code does not write is not one it can act on: an older or
    // newer row is ignored rather than read as installed.
    if (isLifecycleState(note)) states.set(plugin, note);
  }
  return states;
}
