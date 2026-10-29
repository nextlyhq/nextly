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

import { parseEntityHeaders } from "../../schema/migrate-create/format-file";

import { headerLines, parseLocalizationIntent } from "./migration-intent";
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
   * Whether `columns` and `present` describe this entity's companion: no localization file this
   * build cannot read (one written before companion files recorded their intent, or one whose
   * intent does not parse) may be about it, or the last that may comes before a file that makes or
   * drops the companion whole (`create-only` or `enable` with no companion there, or `disable`).
   * Such a file is about the slugs its header names, under any kind, since older files named every
   * kind under `-- Collections:`; one that names none, or cannot be opened, may be about any entity.
   */
  describes(kind: I18nTransitionKind, slug: string): boolean;
  /** Whether any localization file, read or not, may be about this entity. */
  mentions(kind: I18nTransitionKind, slug: string): boolean;
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
 * rather than guessed at, and the entities it may be about are no longer described by the replay
 * (`describes`).
 *
 * Read only: the files are this generator's own, and their SQL is never run or parsed here.
 */
export async function readCompanionHistory(
  migrationsDir: string
): Promise<CompanionHistory> {
  const history = new Map<string, Map<string, LocalizedColumnSpec>>();
  const present = new Set<string>();
  // Positions in the run order: where each companion was last made or dropped whole, by key, and
  // where the last unreadable file comes that may be about each slug, or about any entity.
  const settled = new Map<string, number>();
  const unreadBySlug = new Map<string, number>();
  let unreadAny = -1;
  const unreadAt = (content: string, at: number) => {
    const headers = parseEntityHeaders(content);
    const slugs = [
      ...headers.collections,
      ...headers.singles,
      ...headers.components,
    ];
    if (slugs.length === 0) unreadAny = at;
    for (const slug of slugs) unreadBySlug.set(slug, at);
  };
  const lastUnread = (slug: string) =>
    Math.max(unreadAny, unreadBySlug.get(slug) ?? -1);
  const result = (): CompanionHistory => ({
    columns: history,
    present,
    describes: (kind, slug) =>
      lastUnread(slug) < 0 ||
      (settled.get(companionHistoryKey(kind, slug)) ?? -1) > lastUnread(slug),
    mentions: (kind, slug) =>
      history.has(companionHistoryKey(kind, slug)) || lastUnread(slug) >= 0,
  });

  let names: string[];
  try {
    names = (await readdir(migrationsDir)).filter(f => f.endsWith(".sql"));
  } catch {
    return result();
  }
  for (const [at, name] of names.sort().entries()) {
    let content: string;
    try {
      content = await readFile(resolve(migrationsDir, name), "utf-8");
    } catch {
      unreadAny = at;
      continue;
    }
    let intent;
    try {
      intent = parseLocalizationIntent(content, name);
    } catch {
      unreadAt(content, at);
      continue;
    }
    if (intent === null) {
      // A localization file says so in its header; a migration that only mentions the marker
      // further down is not one.
      if (
        headerLines(content).some(line =>
          line.trim().startsWith(LOCALIZATION_MIGRATION_MARKER)
        )
      ) {
        unreadAt(content, at);
      }
      continue;
    }
    const key = companionHistoryKey(intent.entity, intent.spec.collection);
    const columns = history.get(key) ?? new Map<string, LocalizedColumnSpec>();
    switch (intent.kind) {
      case "create-only":
      case "enable":
        if (!present.has(key)) settled.set(key, at);
        for (const column of intent.spec.columns) {
          columns.set(column.name, column);
        }
        present.add(key);
        break;
      case "joins":
        for (const column of intent.spec.columns) {
          columns.set(column.name, column);
        }
        present.add(key);
        break;
      case "disable":
        columns.clear();
        present.delete(key);
        settled.set(key, at);
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
  return result();
}
