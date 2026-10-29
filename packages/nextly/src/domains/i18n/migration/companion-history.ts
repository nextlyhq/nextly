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

import {
  type LocalizationMigrationIntent,
  parseLocalizationIntent,
} from "./migration-intent";
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
   * Whether `columns` and `present` describe this entity's companion: its first file here makes
   * the companion (`create-only` or `enable`), and no localization file this build cannot read
   * (one written before companion files recorded their intent, or one whose intent does not parse)
   * may be about it. Such a file is about the slugs its header names, under any kind, since older
   * files named every kind under `-- Collections:`; one that names none, or cannot be opened, may
   * be about any entity. Whatever runs after one, a later file cannot vouch for what it did: a
   * create runs only where the companion is not there already. An entity whose first file is not a
   * create may have had its companion made outside the files, as `db:sync` or a development sync
   * makes one.
   */
  describes(kind: I18nTransitionKind, slug: string): boolean;
  /**
   * The files this build cannot read that may be about this entity: those whose header names its
   * slug, and those that name no entity or cannot be opened, which may be anyone's.
   */
  unreadable(kind: I18nTransitionKind, slug: string): string[];
  /** Whether there is any localization file here, read or not. */
  anyFile: boolean;
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
  const replay: Replay = {
    columns: new Map(),
    present: new Set(),
    founded: new Set(),
    unread: [],
  };
  let names: string[];
  try {
    names = (await readdir(migrationsDir)).filter(f => f.endsWith(".sql"));
  } catch (error) {
    // A directory that isn't there holds no history. One that can't be listed may hold any, so it
    // counts as a file this build cannot read, which may be about any entity.
    if ((error as { code?: string }).code !== "ENOENT") {
      replay.unread.push({ name: migrationsDir, slugs: [] });
    }
    return historyOf(replay);
  }
  for (const name of names.sort()) {
    const reading = await readFileIntent(migrationsDir, name);
    if (reading.kind === "intent") replayIntent(replay, reading.intent);
    if (reading.kind === "unread") {
      replay.unread.push({ name, slugs: namedSlugs(reading.content) });
    }
  }
  return historyOf(replay);
}

/**
 * The replay as it stands after the files read so far: each companion's columns, whether it is
 * there, the entities whose first file made it (`founded`), and each unreadable file with the slugs
 * its header names (none: it may be about any entity).
 */
interface Replay {
  columns: Map<string, Map<string, LocalizedColumnSpec>>;
  present: Set<string>;
  founded: Set<string>;
  unread: { name: string; slugs: readonly string[] }[];
}

/** What one migration file says about a companion. */
type FileReading =
  | { kind: "intent"; intent: LocalizationMigrationIntent }
  /** A localization file this build cannot read, with its text when it could be opened. */
  | { kind: "unread"; content: string | null }
  | { kind: "other" };

async function readFileIntent(
  migrationsDir: string,
  name: string
): Promise<FileReading> {
  let content: string;
  try {
    content = await readFile(resolve(migrationsDir, name), "utf-8");
  } catch {
    return { kind: "unread", content: null };
  }
  let intent: LocalizationMigrationIntent | null;
  try {
    intent = parseLocalizationIntent(content, name);
  } catch {
    return { kind: "unread", content };
  }
  if (intent !== null) return { kind: "intent", intent };
  // Read as a localization file the way `migrate:check` reads one: by its marker.
  return content.includes(LOCALIZATION_MIGRATION_MARKER)
    ? { kind: "unread", content }
    : { kind: "other" };
}

/** Applies one file's intent, in the order the files run. */
function replayIntent(
  replay: Replay,
  intent: LocalizationMigrationIntent
): void {
  const key = companionHistoryKey(intent.entity, intent.spec.collection);
  if (!replay.columns.has(key) && MAKES_COMPANION.has(intent.kind)) {
    replay.founded.add(key);
  }
  const columns =
    replay.columns.get(key) ?? new Map<string, LocalizedColumnSpec>();
  const companion = COMPANION_EFFECT[intent.kind](columns, intent.spec.columns);
  if (companion === "made") replay.present.add(key);
  if (companion === "dropped") replay.present.delete(key);
  replay.columns.set(key, columns);
}

/** The kinds of file that make a companion, which an entity's history has to begin with. */
const MAKES_COMPANION = new Set<LocalizationMigrationIntent["kind"]>([
  "create-only",
  "enable",
]);

/** What a file of each kind does to the companion's columns, and to whether it is there. */
const COMPANION_EFFECT: Record<
  LocalizationMigrationIntent["kind"],
  (
    columns: Map<string, LocalizedColumnSpec>,
    named: readonly LocalizedColumnSpec[]
  ) => "made" | "dropped" | "kept"
> = {
  "create-only": addColumns,
  enable: addColumns,
  joins: addColumns,
  disable: columns => {
    columns.clear();
    return "dropped";
  },
  shared: (columns, named) => {
    for (const column of named) columns.delete(column.name);
    return "kept";
  },
  archive: () => "kept",
  unique: () => "kept",
};

function addColumns(
  columns: Map<string, LocalizedColumnSpec>,
  named: readonly LocalizedColumnSpec[]
): "made" {
  for (const column of named) columns.set(column.name, column);
  return "made";
}

/** The slugs an unreadable file's header names, or none when it names none or could not be opened. */
function namedSlugs(content: string | null): string[] {
  if (content === null) return [];
  const headers = parseEntityHeaders(content);
  return [...headers.collections, ...headers.singles, ...headers.components];
}

/** The history the replay leaves. */
function historyOf(replay: Replay): CompanionHistory {
  const unreadFor = (slug: string) =>
    replay.unread.filter(u => u.slugs.length === 0 || u.slugs.includes(slug));
  return {
    columns: replay.columns,
    present: replay.present,
    describes: (kind, slug) =>
      replay.founded.has(companionHistoryKey(kind, slug)) &&
      unreadFor(slug).length === 0,
    unreadable: (_kind, slug) => unreadFor(slug).map(u => u.name),
    anyFile: replay.columns.size > 0 || replay.unread.length > 0,
  };
}
