/**
 * The translated columns each entity's companion holds now, as its migration history says.
 *
 * Every companion file `nextly migrate:create` writes records what it is for in its header (the
 * `-- Localization:` intent), including each column's kind and bounds. Replaying those records in
 * order gives the companion as the files left it, which is the only place a code-first project
 * keeps the shape a translated field's values sit in: the snapshot records the main tables and
 * only the NAMES of the translated columns.
 *
 * A column the files never describe (one a companion gained outside a migration file) is simply
 * absent from the answer; callers treat absence as "not known".
 *
 * @module domains/i18n/migration/companion-history
 */
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { parseLocalizationIntent } from "./migration-intent";
import type { I18nTransitionKind } from "./transition-state";
import type { LocalizedColumnSpec } from "./types";

/** The key an entity's companion is recorded under: its kind and its slug. */
export function companionHistoryKey(
  entity: I18nTransitionKind,
  slug: string
): string {
  return `${entity}:${slug}`;
}

/**
 * Each entity's companion columns, by column name, after every companion file in
 * `migrationsDir`, read in the order they run (by name). A file whose header cannot be read is
 * left out rather than guessed at.
 */
export async function readCompanionColumnHistory(
  migrationsDir: string
): Promise<Map<string, Map<string, LocalizedColumnSpec>>> {
  const history = new Map<string, Map<string, LocalizedColumnSpec>>();
  let names: string[];
  try {
    names = (await readdir(migrationsDir)).filter(f => f.endsWith(".sql"));
  } catch {
    return history;
  }
  for (const name of names.sort()) {
    let intent;
    try {
      intent = parseLocalizationIntent(
        await readFile(resolve(migrationsDir, name), "utf-8"),
        name
      );
    } catch {
      continue;
    }
    if (intent === null) continue;
    const key = companionHistoryKey(intent.entity, intent.spec.collection);
    const columns = history.get(key) ?? new Map<string, LocalizedColumnSpec>();
    switch (intent.kind) {
      case "create-only":
      case "enable":
      case "joins":
        for (const column of intent.spec.columns) {
          columns.set(column.name, column);
        }
        break;
      case "disable":
        columns.clear();
        break;
      case "shared":
        for (const column of intent.spec.columns) columns.delete(column.name);
        break;
      case "archive":
        break;
    }
    history.set(key, columns);
  }
  return history;
}
