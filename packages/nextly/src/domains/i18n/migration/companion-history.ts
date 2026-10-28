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

import { SNAPSHOT_RECORD_MARKER } from "../../schema/migrate-create/format-file";

import { parseLocalizationIntent } from "./migration-intent";
import type { I18nTransitionKind } from "./transition-state";
import type { LocalizedColumnSpec } from "./types";
import { LOCALIZATION_MIGRATION_MARKER } from "./write-migration-file";

/** The key an entity's companion is recorded under: its kind and its slug. */
export function companionHistoryKey(
  entity: I18nTransitionKind,
  slug: string
): string {
  return `${entity}:${slug}`;
}

/** What the companion files say about each entity's companion, by `companionHistoryKey`. */
export interface CompanionHistory {
  /** Its columns, by column name, after every file. */
  columns: Map<string, Map<string, LocalizedColumnSpec>>;
  /**
   * The entities whose companion table the files leave in place. A companion outlives its last
   * column (a `shared` file drops the column and keeps the table), so an empty column map does not
   * say the table is gone; only a `disable` drops it.
   */
  present: Set<string>;
  /**
   * The entities whose first file here makes their companion (`enable` or `create-only`), so the
   * files describe every column it has had.
   */
  founded: Set<string>;
  /**
   * Whether a companion file this build cannot read comes after the last snapshot record: one
   * written before companion files recorded their intent, or one whose intent does not parse. The
   * columns such a file made or dropped are missing from `columns`, for any entity it may be for.
   */
  unread: boolean;
}

/**
 * Each entity's companion columns, by column name, after every companion file in
 * `migrationsDir`, read in the order they run (by name). A file whose header cannot be read is
 * left out rather than guessed at.
 */
export async function readCompanionColumnHistory(
  migrationsDir: string
): Promise<Map<string, Map<string, LocalizedColumnSpec>>> {
  return (await readCompanionHistory(migrationsDir)).columns;
}

/**
 * The companion files in `migrationsDir` replayed in the order they run (by name): each entity's
 * columns, and whether its table is still there. A file whose header cannot be read is left out
 * rather than guessed at, and said to be there (`unread`).
 *
 * Read only: the files are this generator's own, and their SQL is never run or parsed here.
 */
export async function readCompanionHistory(
  migrationsDir: string
): Promise<CompanionHistory> {
  const history = new Map<string, Map<string, LocalizedColumnSpec>>();
  const present = new Set<string>();
  const founded = new Set<string>();
  let unread = false;
  let names: string[];
  try {
    names = (await readdir(migrationsDir)).filter(f => f.endsWith(".sql"));
  } catch {
    return { columns: history, present, founded, unread };
  }
  for (const name of names.sort()) {
    let content: string;
    try {
      content = await readFile(resolve(migrationsDir, name), "utf-8");
    } catch {
      unread = true;
      continue;
    }
    if (content.includes(SNAPSHOT_RECORD_MARKER)) {
      unread = false;
      continue;
    }
    let intent;
    try {
      intent = parseLocalizationIntent(content, name);
    } catch {
      unread = true;
      continue;
    }
    if (intent === null) {
      if (content.includes(LOCALIZATION_MIGRATION_MARKER)) unread = true;
      continue;
    }
    const key = companionHistoryKey(intent.entity, intent.spec.collection);
    if (
      !history.has(key) &&
      (intent.kind === "enable" || intent.kind === "create-only")
    ) {
      founded.add(key);
    }
    const columns = history.get(key) ?? new Map<string, LocalizedColumnSpec>();
    switch (intent.kind) {
      case "create-only":
      case "enable":
      case "joins":
        for (const column of intent.spec.columns) {
          columns.set(column.name, column);
        }
        present.add(key);
        break;
      case "disable":
        columns.clear();
        present.delete(key);
        break;
      case "shared":
        for (const column of intent.spec.columns) columns.delete(column.name);
        break;
      case "archive":
      case "unique":
        break;
    }
    history.set(key, columns);
  }
  return { columns: history, present, founded, unread };
}
