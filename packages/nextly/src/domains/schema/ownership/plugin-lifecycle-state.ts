/**
 * Whether each plugin is installed, being uninstalled, or uninstalled,
 * recorded apart from the tables it owns.
 *
 * The owner rows say what became of a plugin's TABLES, and a plugin that owns
 * none has no rows: its uninstall changed no state anywhere, and the install
 * of a plugin depending on it took it for installed whether its `onInstall`
 * had ever run. So `nextly plugins install` and `uninstall` record the
 * plugin's own state, as an event in the schema ledger, and the boot and the
 * install check read it.
 *
 * A plugin is installed only once `nextly plugins install` has recorded it.
 * Modules applied by `nextly migrate` alone do not make one installed: its
 * `onInstall` has not run.
 *
 * One module for the write and every read, so they cannot disagree about
 * which event counts or what it says.
 *
 * @module domains/schema/ownership/plugin-lifecycle-state
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { newestEvent } from "../events/newest-event";
import type {
  SchemaEventRow,
  SchemaEventsRepository,
} from "../events/schema-events-repository";

import type { OwnerRecord } from "./owner-registry";

/**
 * A plugin's recorded state. `uninstalling` is written before an uninstall's
 * first change and replaced when it finishes, so one still read is an
 * uninstall that stopped part way; `keepData` is how it was run.
 */
export type PluginLifecycleRecord =
  | { state: "installed" }
  | { state: "uninstalling"; keepData: boolean }
  | { state: "uninstalled" }
  | { state: "orphaned" };

/** How each record is written into the event's `note`. */
const NOTES = {
  installed: { state: "installed" },
  "uninstalling:full": { state: "uninstalling", keepData: false },
  "uninstalling:keep-data": { state: "uninstalling", keepData: true },
  uninstalled: { state: "uninstalled" },
  orphaned: { state: "orphaned" },
} as const satisfies Record<string, PluginLifecycleRecord>;

type Note = keyof typeof NOTES;

function noteOf(record: PluginLifecycleRecord): Note {
  if (record.state !== "uninstalling") return record.state;
  return record.keepData ? "uninstalling:keep-data" : "uninstalling:full";
}

function recordOf(note: string | null): PluginLifecycleRecord | undefined {
  return note !== null && Object.hasOwn(NOTES, note)
    ? NOTES[note as Note]
    : undefined;
}

/**
 * The ledger key a plugin's lifecycle events are recorded under.
 *
 * One key per plugin is what orders them: the ledger stamps each new event
 * after the newest one under its key, so an install and the uninstall that
 * follows within a millisecond still read in that order. A namespace of its
 * own, so no migration file, and no plugin module, whose keys are
 * `plugin:<name>/<module>`, can share it.
 */
export function pluginLifecycleKey(pluginName: string): string {
  return `plugin-lifecycle:${pluginName}`;
}

/** Record a plugin's new state. */
export async function recordPluginLifecycle(
  events: SchemaEventsRepository,
  pluginName: string,
  record: PluginLifecycleRecord
): Promise<void> {
  await events.insertEvent({
    eventType: "plugin_lifecycle",
    status: "applied",
    source: "cli-plugin-migrate",
    filename: pluginLifecycleKey(pluginName),
    scopeKind: "plugin",
    scopeSlug: pluginName,
    note: noteOf(record),
    endedAt: new Date(),
  });
}

/**
 * Each plugin's state, by name, from its newest lifecycle event.
 *
 * A plugin with no event and owner rows marked `uninstalled` or `orphaned`
 * was uninstalled before these events were written, and reads as that. A
 * plugin with neither was never installed by the command, and is absent.
 */
export async function readPluginLifecycle(
  events: Pick<SchemaEventsRepository, "listPluginLifecycle">,
  owners: readonly Pick<OwnerRecord, "ownerId" | "state">[]
): Promise<Map<string, PluginLifecycleRecord>> {
  const byPlugin = new Map<string, SchemaEventRow[]>();
  for (const row of await events.listPluginLifecycle()) {
    if (!row.scopeSlug) continue;
    byPlugin.set(row.scopeSlug, [...(byPlugin.get(row.scopeSlug) ?? []), row]);
  }
  const states = new Map<string, PluginLifecycleRecord>();
  for (const [plugin, rows] of byPlugin) {
    // A note this code does not write is not a state it can act on: read as
    // no record, which no check takes for installed.
    const record = recordOf(newestEvent(rows)?.note ?? null);
    if (record !== undefined) states.set(plugin, record);
  }
  for (const row of owners) {
    if (states.has(row.ownerId) || row.state === "active") continue;
    states.set(row.ownerId, { state: row.state });
  }
  return states;
}

/**
 * The boot a lifecycle command makes to run a plugin's `onInstall` or
 * `onUninstall`, during which the install-state gate does not refuse.
 *
 * That boot runs while the plugin is mid-install or mid-uninstall, which is
 * exactly the state the gate refuses, and it is no server: it builds the
 * hook's context and is torn down. Every other configured plugin may be
 * uninstalled too, since plugins are installed one at a time. Kept out of the
 * service config, which is public, so no app can switch the gate off.
 */
const lifecycleCommandBoot = new AsyncLocalStorage<{ target: string }>();

/**
 * Runs `work` as the boot of a lifecycle command for the plugin `target`.
 * Inside it, only that plugin initialises: see `pluginsToInitialize`.
 */
export function asLifecycleCommandBoot<T>(
  target: string,
  work: () => Promise<T>
): Promise<T> {
  return lifecycleCommandBoot.run({ target }, work);
}

export function isLifecycleCommandBoot(): boolean {
  return lifecycleCommandBoot.getStore() !== undefined;
}

/**
 * The configured plugins a boot initialises. Every one, except in a lifecycle
 * command's boot, where only the command's target runs: a sibling that is not
 * installed, or is mid-uninstall, must not reach `init()` against a schema the
 * command is changing, and the boot exists only to give the target's hook its
 * context.
 */
export function pluginsToInitialize<P extends { name: string }>(
  plugins: readonly P[]
): P[] {
  const scope = lifecycleCommandBoot.getStore();
  if (scope === undefined) return [...plugins];
  return plugins.filter(plugin => plugin.name === scope.target);
}
