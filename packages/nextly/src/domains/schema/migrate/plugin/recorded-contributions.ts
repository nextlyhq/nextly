/**
 * Which elements of other owners' tables a plugin contributed, as its modules
 * record them.
 *
 * Lives beside the module format rather than in the generator because two
 * sides ask the same question: the generator, to know what the previous
 * modules left contributed before it diffs the next one, and the runner, to
 * judge a module's contributed tables on the plugin's own elements at apply
 * time. One implementation, so the two cannot disagree about which elements
 * are the plugin's.
 *
 * @module domains/schema/migrate/plugin/recorded-contributions
 * @since 1.0.0
 */
import type { SupportedDialect } from "../../../../database/schema-registry";
import { NO_ELEMENTS } from "../../migrate-create/app-stream";
import type { ContributedElements, TableSpec } from "../../pipeline/diff/types";

import { orderedMigrations, type PluginMigration } from "./plugin-migration";

/**
 * This plugin's contributed element names on one dialect, as the modules it
 * already ships leave them.
 *
 * A module that records `contributions` states them outright. One generated
 * before they were recorded is replayed from its own sides instead: what its
 * `contributed` tables have that its `contributedBefore` tables do not, it
 * added, and the reverse it removed. Both sides of such a module were built
 * on the same owner declaration, so the owner's own columns never show up as
 * a difference. Taking a recordless module as "no contributions" would make
 * the next module add the plugin's columns a second time.
 */
export function recordedContributions(
  existing: readonly PluginMigration[],
  dialect: SupportedDialect
): Record<string, ContributedElements> {
  let state: Record<string, ContributedElements> = {};
  for (const module of orderedMigrations(existing)) {
    if (module.contributions !== undefined) {
      state = { ...(module.contributions[dialect] ?? {}) };
      continue;
    }
    state = replayContributions(
      state,
      module.contributedBefore?.[dialect]?.tables ?? [],
      module.contributed?.[dialect]?.tables ?? []
    );
  }
  return state;
}

/** The element kinds a contribution records, keyed as `TableSpec` keys them. */
const ELEMENT_KINDS = ["columns", "indexes", "foreignKeys", "checks"] as const;

/** `state`, plus what `after` adds over `before`, minus what it drops. */
function replayContributions(
  state: Record<string, ContributedElements>,
  before: readonly TableSpec[],
  after: readonly TableSpec[]
): Record<string, ContributedElements> {
  const next: Record<string, ContributedElements> = { ...state };
  const beforeByName = new Map(before.map(table => [table.name, table]));
  const afterByName = new Map(after.map(table => [table.name, table]));
  for (const name of new Set([...beforeByName.keys(), ...afterByName.keys()])) {
    const current = next[name] ?? NO_ELEMENTS;
    const merged = { ...NO_ELEMENTS };
    for (const kind of ELEMENT_KINDS) {
      merged[kind] = replayed(
        current[kind],
        beforeByName.get(name)?.[kind],
        afterByName.get(name)?.[kind]
      );
    }
    if (ELEMENT_KINDS.every(kind => merged[kind].length === 0)) {
      delete next[name];
    } else {
      next[name] = merged;
    }
  }
  return next;
}

/** One kind's names after a module: kept, plus added, minus dropped. */
function replayed(
  names: readonly string[],
  before: readonly { name: string }[] | undefined,
  after: readonly { name: string }[] | undefined
): string[] {
  const was = new Set((before ?? []).map(element => element.name));
  const now = new Set((after ?? []).map(element => element.name));
  const out = new Set(names);
  for (const name of now) if (!was.has(name)) out.add(name);
  for (const name of was) if (!now.has(name)) out.delete(name);
  return [...out].sort();
}
