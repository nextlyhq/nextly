/**
 * Which collections and Singles a migration file retires.
 *
 * Judged from what `migrate:create` records beside the file, never from its SQL alone: a file
 * retires an entity the snapshot before it declares and its own does not, whose main table that
 * snapshot holds and its own does not, and which the file drops. A table changed, rebuilt, or kept
 * under another slug is in the file's own snapshot, so it is never one, however its SQL reads.
 *
 * The file's text is read for the one thing the snapshots cannot say, whether the table is dropped
 * or renamed, and only in plain forms: a file that says neither plainly is not guessed at.
 * `unsettled` names what such a file leaves open, for the run to refuse. Where the file is not the
 * text its snapshot was written for (edited, or a dialect's own variant, which has no hash), only a
 * plain drop retires, and anything else is unsettled.
 *
 * A file with no snapshot, or beside one that records no declarations, says nothing of what is
 * retired: it applies as it is (`droppedRegisteredEntities`, for what the run says of it).
 *
 * @module domains/schema/migrate/retired-entities
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import { isReservedResourceSlug } from "../../../schemas/_zod/rbac";
import { recordedEntityTable } from "../migrate-create/dropped-translations";
import type { RecordedEntitySettings } from "../migrate-create/entity-settings";
import {
  computeMigrationHash,
  type SnapshotFile,
} from "../migrate-create/snapshot-io";

import type { CoveredEntity } from "./entity-coverage";
import { RECORDED_KINDS } from "./registry-history";
import { statementTokens } from "./split-sql";
import { renamesIn } from "./statement-targets";
import { storedNamesDroppedIn } from "./stored-names";

/** A collection or Single, with the main table its documents are in. */
export interface RetiredEntity {
  kind: "collection" | "single";
  slug: string;
  table: string;
}

/** What a file retires, and what it may retire but does not say plainly. */
export interface Retirements {
  retired: RetiredEntity[];
  unsettled: RetiredEntity[];
}

/** What of a snapshot a retirement is judged from. */
type RecordedPoint = Pick<SnapshotFile, "snapshot" | "entities">;

/**
 * Whether `content` is the text `hash` was recorded for, its line endings aside: a checkout that
 * writes CRLF edits nothing. The recorded hash is of the text as written, so both endings of
 * `content` are compared with it.
 */
export function matchesMigrationHash(content: string, hash: string): boolean {
  const lf = content.replace(/\r\n/g, "\n");
  return [content, lf, lf.replace(/\n/g, "\r\n")].some(
    text => computeMigrationHash(text) === hash
  );
}

/**
 * What a file made of `statements` retires, between the point `before` and its own, `after`. With
 * `matches`, the file is the text its snapshot was written for (`matchesMigrationHash`).
 */
export function retirementsOf(file: {
  before: RecordedPoint | null;
  after: RecordedPoint | null;
  statements: readonly string[];
  dialect: SupportedDialect;
  matches: boolean;
}): Retirements {
  const retirements: Retirements = { retired: [], unsettled: [] };
  for (const entity of leftOut(file.before, file.after)) {
    const fate = fateOf(entity.table, file.statements, file.dialect);
    if (fate === "dropped") {
      retirements.retired.push(entity);
    } else if (!file.matches || fate === "unclear") {
      retirements.unsettled.push(entity);
    }
  }
  return retirements;
}

/**
 * What a file of text `content` retires between two snapshots, or undefined where either is missing
 * or records no declarations, so nothing says. `recordedHash` is what its own snapshot recorded.
 */
export function fileRetirements(
  file: Omit<Parameters<typeof retirementsOf>[0], "matches"> & {
    content: string;
    recordedHash: string | undefined;
  }
): Retirements | undefined {
  const { content, recordedHash, ...points } = file;
  if (
    points.before?.entities === undefined ||
    points.after?.entities === undefined
  ) {
    return undefined;
  }
  return retirementsOf({
    ...points,
    matches:
      recordedHash !== undefined && matchesMigrationHash(content, recordedHash),
  });
}

/**
 * The refusal of `filename`, where it leaves an entity unsettled: the file differs from its snapshot
 * on whether the entity's table is dropped. Undefined where it settles every one.
 */
export function unsettledRetirement(
  filename: string,
  judged: Retirements | undefined
): NextlyError | undefined {
  if (judged === undefined || judged.unsettled.length === 0) return undefined;
  const named = judged.unsettled.map(
    ({ kind, slug, table }) => `${kind} ${slug} (${table})`
  );
  return NextlyError.conflict({
    reason: "state",
    message: `\`${filename}\` differs from its snapshot: the snapshot records ${named.join(", ")} as removed, and the file does not plainly drop it and nothing else of that name, so whether its documents end cannot be told. Nothing was applied. Restore the file as \`nextly migrate:create\` wrote it, or write its drop as a plain \`DROP TABLE\` with no rename to or from that table, then run the command again.`,
  });
}

/**
 * The collections and Singles of `entities` whose main table a file with no snapshot plainly drops:
 * one that only rebuilds it keeps it.
 */
export function droppedRegisteredEntities(
  entities: readonly CoveredEntity[],
  statements: readonly string[],
  dialect: SupportedDialect
): RetiredEntity[] {
  return entities.flatMap(({ kind, slug, table, excluded }) =>
    kind !== "fieldGroup" &&
    excluded !== true &&
    fateOf(table, statements, dialect) === "dropped"
      ? [{ kind, slug, table }]
      : []
  );
}

/** The collections and Singles `before` declares, with a main table, and `after` has neither of. */
function leftOut(
  before: RecordedPoint | null,
  after: RecordedPoint | null
): RetiredEntity[] {
  if (before?.entities === undefined || after?.entities === undefined) {
    return [];
  }
  const [was, now] = [before.entities, after.entities];
  const [had, has] = [before, after].map(
    point => new Set(point.snapshot.tables.map(table => table.name))
  );
  return RECORDED_KINDS.flatMap(([kind, key]) =>
    kind === "fieldGroup" ? [] : goneOf(kind, was[key], now[key])
  ).filter(({ table }) => had.has(table) && !has.has(table));
}

/** The entities of one kind `was` declares and `now` does not, each with its main table. */
function goneOf(
  kind: RetiredEntity["kind"],
  was: Readonly<Record<string, RecordedEntitySettings>>,
  now: Readonly<Record<string, RecordedEntitySettings>>
): RetiredEntity[] {
  return Object.entries(was)
    .filter(
      ([slug]) => !Object.hasOwn(now, slug) && !isReservedResourceSlug(slug)
    )
    .map(([slug, entry]) => ({
      kind,
      slug,
      table: recordedEntityTable(kind, slug, entry),
    }));
}

/**
 * What `statements` plainly do with `table`: drop it, renaming nothing to or from it; keep it, which
 * a rename of it does; or neither plainly, where a statement that may drop or rename it is not read.
 */
function fateOf(
  table: string,
  statements: readonly string[],
  dialect: SupportedDialect
): "dropped" | "kept" | "unclear" {
  const name = table.toLowerCase();
  let dropped = false;
  let renamed = false;
  for (const statement of statements) {
    // On PostgreSQL by the spelling the catalog keeps; elsewhere without regard to case, as before.
    const drops = storedNamesDroppedIn(statement, dialect);
    if (
      dialect === "postgresql"
        ? drops.includes(table)
        : drops.some(each => each.toLowerCase() === name)
    ) {
      dropped = true;
      continue;
    }
    const renames = renamesIn(statement, dialect);
    if (renames === undefined) {
      if (mayDropOrRename(statement, name, dialect)) return "unclear";
      continue;
    }
    renamed ||= renames.some(
      each => each.kind === "table" && (each.from === name || each.to === name)
    );
  }
  if (dropped) return renamed ? "unclear" : "dropped";
  return "kept";
}

/** Words of a statement that drops a table or renames something. */
const DROPS_OR_RENAMES = /\b(rename|drop\s+(temporary\s+)?tables?)\b/;

/**
 * Whether a statement read by neither reader may drop or rename the table `name`: it names the
 * table, in a string it holds included, and drops a table or renames something.
 */
function mayDropOrRename(
  statement: string,
  name: string,
  dialect: SupportedDialect
): boolean {
  const said = statementTokens(statement, dialect)
    .map(token =>
      typeof token === "string"
        ? token
        : (token.written ?? token.name ?? token.text ?? statement)
    )
    .join(" ")
    .toLowerCase();
  return DROPS_OR_RENAMES.test(said) && wordsOf(said).has(name);
}

/** The names in `text`, each as a whole word. */
function wordsOf(text: string): Set<string> {
  return new Set(text.match(/[\p{L}\p{N}_$]+/gu) ?? []);
}
