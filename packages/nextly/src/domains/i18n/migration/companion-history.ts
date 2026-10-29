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
   * Whether `columns` and `present` describe this entity's companion: a file makes or drops it
   * whole (`create-only` or `enable` with no companion there, or `disable`) after every localization
   * file this build cannot read (one written before companion files recorded their intent, or one
   * whose intent does not parse) that may be about it. Such a file is about the slugs its header
   * names, under any kind, since older files named every kind under `-- Collections:`; one that
   * names none, or cannot be opened, may be about any entity. An entity no file makes or drops is not
   * described: its companion may have come from outside the files, as a development sync or
   * `db:sync` makes one.
   */
  describes(kind: I18nTransitionKind, slug: string): boolean;
  /**
   * Whether a localization file is about this entity: one this build reads for it, or one it
   * cannot read whose header names its slug. A file that names no entity is not counted.
   */
  mentions(kind: I18nTransitionKind, slug: string): boolean;
  /**
   * Whether a localization file may be about this entity: one that `mentions` it, or one this
   * build cannot read that names no entity at all, which may be anyone's.
   */
  mayBeAbout(kind: I18nTransitionKind, slug: string): boolean;
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
    settled: new Map(),
    unreadBySlug: new Map(),
    unreadAny: -1,
  };
  let names: string[];
  try {
    names = (await readdir(migrationsDir)).filter(f => f.endsWith(".sql"));
  } catch {
    return historyOf(replay);
  }
  for (const [at, name] of names.sort().entries()) {
    const reading = await readFileIntent(migrationsDir, name);
    if (reading.kind === "intent") replayIntent(replay, reading.intent, at);
    if (reading.kind === "unread") replayUnread(replay, reading.content, at);
  }
  return historyOf(replay);
}

/**
 * The replay as it stands after the files read so far. Positions are in the run order: where
 * each companion was last made or dropped whole, by key (`settled`), and where the last
 * unreadable file comes that may be about each slug, or about any entity.
 */
interface Replay {
  columns: Map<string, Map<string, LocalizedColumnSpec>>;
  present: Set<string>;
  settled: Map<string, number>;
  unreadBySlug: Map<string, number>;
  unreadAny: number;
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

/** Applies one file's intent, at position `at` in the run order. */
function replayIntent(
  replay: Replay,
  intent: LocalizationMigrationIntent,
  at: number
): void {
  const key = companionHistoryKey(intent.entity, intent.spec.collection);
  const columns =
    replay.columns.get(key) ?? new Map<string, LocalizedColumnSpec>();
  if (settlesCompanion(intent.kind, replay.present.has(key))) {
    replay.settled.set(key, at);
  }
  const companion = COMPANION_EFFECT[intent.kind](columns, intent.spec.columns);
  if (companion === "made") replay.present.add(key);
  if (companion === "dropped") replay.present.delete(key);
  replay.columns.set(key, columns);
}

/**
 * Whether a file makes or drops the companion whole, so the files after it describe every column
 * it has: a `disable`, or a `create-only` or `enable` with no companion there.
 */
function settlesCompanion(
  kind: LocalizationMigrationIntent["kind"],
  present: boolean
): boolean {
  return kind === "disable" || (!present && MAKES_COMPANION.has(kind));
}

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

/**
 * Counts an unreadable file at `at` against the slugs its header names, or against every entity
 * when it names none or could not be opened.
 */
function replayUnread(
  replay: Replay,
  content: string | null,
  at: number
): void {
  const headers = content === null ? null : parseEntityHeaders(content);
  const slugs = headers
    ? [...headers.collections, ...headers.singles, ...headers.components]
    : [];
  if (slugs.length === 0) replay.unreadAny = at;
  for (const slug of slugs) replay.unreadBySlug.set(slug, at);
}

/** The history the replay leaves. */
function historyOf(replay: Replay): CompanionHistory {
  const lastUnread = (slug: string) =>
    Math.max(replay.unreadAny, replay.unreadBySlug.get(slug) ?? -1);
  const mentions = (kind: I18nTransitionKind, slug: string) =>
    replay.columns.has(companionHistoryKey(kind, slug)) ||
    replay.unreadBySlug.has(slug);
  return {
    columns: replay.columns,
    present: replay.present,
    describes: (kind, slug) =>
      (replay.settled.get(companionHistoryKey(kind, slug)) ?? -1) >
      lastUnread(slug),
    mentions,
    mayBeAbout: (kind, slug) => mentions(kind, slug) || replay.unreadAny >= 0,
  };
}
