/**
 * The rows of suggested translations, kept in step with what they belong to.
 *
 * A suggestion goes with its document, its field and its row, and follows a renamed field and a
 * converted language code. Each function here takes the transaction of the change it follows, so
 * the two land together or not at all. What goes with a whole collection or Single is removed with
 * the rest of its translations' rows (`removeEntitySuggestions`).
 *
 * @experimental
 *
 * @module domains/i18n/pipeline/suggestion-rows
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SupportedDialect,
  TransactionContext,
  WhereCondition,
} from "@nextlyhq/adapter-drizzle/types";

import type { ProvenanceScopeKind } from "../../../schemas/translation-provenance";
import { TRANSLATION_SUGGESTIONS_TABLE } from "../../../schemas/translation-suggestions";
import { parsedValue } from "../../../shared/lib/json-column-value";
import { isPlainObject } from "../../../shared/lib/plain-copy";
import {
  tablePresence,
  transactionTableProbe,
  type DashboardLogger,
  type TableProbe,
} from "../../dashboard/table-presence";
import { quoteIdent } from "../../schema/pipeline/sql-templates/identifier-quoting";
import { quoteSqlLiteral } from "../../schema/utils/sql-literal";
import { rowKeys } from "../shared-structure";

import {
  parseUnitAddress,
  renamedUnit,
  unitField,
  unitKey,
  type UnitSegment,
} from "./unit-address";

/** The surface of a transaction suggestions are read and written through. */
export type SuggestionRowsDb = Pick<
  TransactionContext,
  "select" | "updateCount" | "delete"
>;

/** One collection or Single. */
export interface SuggestionScope {
  scopeKind: ProvenanceScopeKind;
  scopeSlug: string;
}

/** One document of it. */
export interface SuggestedDocument extends SuggestionScope {
  entryId: string;
}

/** A field of one collection or Single, given a new name. */
export interface SuggestedFieldRename extends SuggestionScope {
  from: string;
  to: string;
}

/**
 * Whether the suggestions table exists yet, asked once per database and remembered once found
 * (`tablePresence`). It reaches an installation through `nextly migrate`, so until then no
 * suggestion is kept. A write asks `via` its own transaction's connection before any statement
 * against the table: on PostgreSQL a statement against a missing table aborts the whole
 * transaction, the write with it.
 */
const presenceByDb = new WeakMap<
  TableProbe,
  (via?: TableProbe) => Promise<boolean>
>();

export function translationSuggestionsPresent(
  db: TableProbe,
  logger?: DashboardLogger,
  via?: TableProbe
): Promise<boolean> {
  let present = presenceByDb.get(db);
  if (present === undefined) {
    present = tablePresence(
      db,
      TRANSLATION_SUGGESTIONS_TABLE,
      "Suggested translations are not being kept",
      logger
    );
    presenceByDb.set(db, present);
  }
  return present(via);
}

/** The rows of one collection or Single. */
function scopeConditions(scope: SuggestionScope): WhereCondition[] {
  return [
    { column: "scopeKind", op: "=", value: scope.scopeKind },
    { column: "scopeSlug", op: "=", value: scope.scopeSlug },
  ];
}

/** The rows of one document. */
function documentConditions(document: SuggestedDocument): WhereCondition[] {
  return [
    ...scopeConditions(document),
    { column: "entryId", op: "=", value: document.entryId },
  ];
}

/** Removes the rows with `ids`. */
async function removeRows(
  db: Pick<SuggestionRowsDb, "delete">,
  ids: readonly string[]
): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(TRANSLATION_SUGGESTIONS_TABLE, {
    and: [{ column: "id", op: "IN", value: [...ids] }],
  });
}

/**
 * Removes every suggestion a deleted document had, in every language, on `tx`, the delete's own
 * transaction. Nothing is done until the table is there.
 */
export async function forgetDocumentSuggestions(
  site: {
    adapter: Pick<DrizzleAdapter, "tableExists" | "tableExistsThrough">;
    logger?: DashboardLogger;
  },
  tx: TransactionContext,
  document: SuggestedDocument
): Promise<void> {
  const { adapter, logger } = site;
  const probe = transactionTableProbe(adapter, tx);
  if (!(await translationSuggestionsPresent(adapter, logger, probe))) return;
  await tx.delete(TRANSLATION_SUGGESTIONS_TABLE, {
    and: documentConditions(document),
  });
}

/**
 * Removes the suggestions for every text in `fields`, across a collection's or Single's documents,
 * on `db`, the transaction of the change that removes the fields or stops translating them.
 */
export async function forgetFieldSuggestions(
  db: Pick<SuggestionRowsDb, "delete">,
  scope: SuggestionScope,
  fields: readonly string[]
): Promise<void> {
  if (fields.length === 0) return;
  await db.delete(TRANSLATION_SUGGESTIONS_TABLE, {
    and: [
      ...scopeConditions(scope),
      { column: "fieldPath", op: "IN", value: [...fields] },
    ],
  });
}

/**
 * Moves a renamed field's suggestions to its new name, on `db`, one transaction: each text's
 * address starts in its field, so the address and the key hashed from it are written again with
 * the name. A suggestion an earlier field left under the new name is another field's text, and
 * would stand in a moved row's place, so it goes first. One whose address cannot be read, or
 * starts in another field, names no text of the renamed field, and goes.
 */
export async function renameFieldSuggestions(
  db: SuggestionRowsDb,
  rename: SuggestedFieldRename
): Promise<void> {
  if (rename.from === rename.to) return;
  const rows = await db.select<{
    id: string;
    fieldPath: string;
    unitAddress: unknown;
  }>(TRANSLATION_SUGGESTIONS_TABLE, {
    columns: ["id", "fieldPath", "unitAddress"],
    where: {
      and: [
        ...scopeConditions(rename),
        { column: "fieldPath", op: "IN", value: [rename.from, rename.to] },
      ],
    },
  });
  // Told apart by the name itself: MySQL compares without regard to case, and a rename may change
  // nothing else.
  const moving = rows.filter(row => row.fieldPath === rename.from);
  if (moving.length === 0) return;
  await removeRows(
    db,
    rows.filter(row => row.fieldPath === rename.to).map(row => row.id)
  );
  for (const row of moving) {
    const address = parseUnitAddress(row.unitAddress);
    if (address === null || unitField(address) !== rename.from) {
      await removeRows(db, [row.id]);
      continue;
    }
    const moved = renamedUnit(address, rename.from, rename.to);
    await db.updateCount(
      TRANSLATION_SUGGESTIONS_TABLE,
      { fieldPath: rename.to, unitAddress: moved, unitKey: unitKey(moved) },
      { and: [{ column: "id", op: "=", value: row.id }] }
    );
  }
}

/**
 * The statement that settles a renamed field's suggestions by hand, where the move that should
 * have (`renameFieldSuggestions`) did not land. A statement cannot hash an address again, so it
 * removes them: under the old name they name a text no document has. Text for a developer, never
 * run here.
 */
export function renameFieldSuggestionsStatements(
  dialect: SupportedDialect,
  rename: SuggestedFieldRename
): string[] {
  const id = (name: string) => quoteIdent(name, dialect);
  const text = (value: string) => quoteSqlLiteral(value, dialect);
  return [
    `DELETE FROM ${id(TRANSLATION_SUGGESTIONS_TABLE)} WHERE ${id("scope_kind")} = ${text(rename.scopeKind)} AND ${id("scope_slug")} = ${text(rename.scopeSlug)} AND ${id("field_path")} = ${text(rename.from)};`,
  ];
}

/**
 * Whether the row an address leads through is gone from the structure now stored. Only a list that
 * was read and does not hold the row says so (`null` is a list nothing is in). A step the structure
 * does not hold (a value each language keeps apart) says nothing of the rows below it, and a
 * page-builder block's rows are not a list's.
 */
function rowIsGone(structure: unknown, steps: readonly UnitSegment[]): boolean {
  let from: unknown = structure ?? null;
  for (const step of steps) {
    const next = stepInStructure(parsedValue(from), step);
    if (next === "gone") return true;
    if (next === "unknown") return false;
    from = next.value;
  }
  return false;
}

/** What one step leads to in a structure: its value, a row that is gone, or nothing it can say. */
function stepInStructure(
  value: unknown,
  step: UnitSegment
): { value: unknown } | "gone" | "unknown" {
  if ("field" in step) {
    return isPlainObject(value) && Object.hasOwn(value, step.field)
      ? { value: value[step.field] }
      : "unknown";
  }
  if ("node" in step) return "unknown";
  if (value === null) return "gone";
  if (!Array.isArray(value)) return "unknown";
  const index = rowKeys(value).indexOf(step.row);
  return index === -1 ? "gone" : { value: value[index] as unknown };
}

/** The way down to an address's last row; none for a text in no row. */
function stepsToRow(steps: readonly UnitSegment[]): readonly UnitSegment[] {
  return steps.slice(0, steps.findLastIndex(step => "row" in step) + 1);
}

/**
 * Whether a held draft holds the row an address leads to: in the rows themselves, or, in a draft of
 * one language's text alone, among the entries kept by row id.
 */
function draftHoldsRow(value: unknown, steps: readonly UnitSegment[]): boolean {
  let from: unknown = value;
  for (const step of steps) {
    if ("node" in step) return true;
    const level = parsedValue(from);
    const at = "row" in step ? step.row : step.field;
    if (Array.isArray(level)) {
      const index = rowKeys(level).indexOf(at);
      if (index === -1) return false;
      from = level[index];
    } else if (isPlainObject(level) && Object.hasOwn(level, at)) {
      from = level[at];
    } else return false;
  }
  return true;
}

/** A document's working draft, as it is stored. */
interface HeldDraft {
  snapshot: unknown;
}

/**
 * Removes, in every language, the suggestions for each text in a row a write removed from the one
 * structure every language shares, at any depth, on `db`, the write's own transaction. A removed
 * row takes its text with it in every language, and its suggestions would be for a text no document
 * has. A row moved within its list keeps them: a row is named by its id. So does a row a held draft
 * still holds, as its draft's records are kept; the document's `drafts` are read where one may.
 */
export async function forgetRemovedRowsSuggestions(
  db: Pick<SuggestionRowsDb, "select" | "delete">,
  document: SuggestedDocument,
  written: ReadonlyArray<{
    /** The document's own field, a repeater's or a group's. */
    field: string;
    /** The structure written, as stored (JSON text allowed). */
    structure: unknown;
  }>,
  drafts: () => Promise<readonly HeldDraft[]> = () => Promise.resolve([])
): Promise<void> {
  if (written.length === 0) return;
  const structures = new Map(
    written.map(({ field, structure }) => [field, structure])
  );
  const rows = await db.select<{
    id: string;
    fieldPath: string;
    unitAddress: unknown;
  }>(TRANSLATION_SUGGESTIONS_TABLE, {
    columns: ["id", "fieldPath", "unitAddress"],
    where: {
      and: [
        ...documentConditions(document),
        { column: "fieldPath", op: "IN", value: [...structures.keys()] },
      ],
    },
  });
  const gone = rows.flatMap(({ id, fieldPath, unitAddress }) => {
    const address = parseUnitAddress(unitAddress);
    if (address === null || !structures.has(fieldPath)) return [];
    const [, ...steps] = address;
    return rowIsGone(structures.get(fieldPath), steps)
      ? [{ id, steps: stepsToRow(address) }]
      : [];
  });
  if (gone.length === 0) return;
  const held = (await drafts()).map(draft => draft.snapshot);
  await removeRows(
    db,
    gone
      .filter(({ steps }) => !held.some(each => draftHoldsRow(each, steps)))
      .map(({ id }) => id)
  );
}

/** What says which of two suggestions for one text is the newer. */
export interface SuggestionAge {
  id: string;
  createdAt: Date;
}

/**
 * The newer of two suggestions for one text: by when each was made, then, where both were made in
 * the same second (all SQLite keeps), by id, so every run answers alike.
 */
export function newerSuggestion<T extends SuggestionAge>(a: T, b: T): T {
  const [first, second] = [a.createdAt.getTime(), b.createdAt.getTime()];
  if (first !== second) return first > second ? a : b;
  return a.id > b.id ? a : b;
}

/**
 * Moves every suggestion kept under a language code written an earlier way to the code's standard
 * form, on `db`, one transaction: the language each was made from, and the language each is in.
 * Where a text has a suggestion under both, the two become one text's, and the newer is kept: a
 * suggestion is one open offer, and the newer one takes an older one's place.
 */
export async function convertSuggestionCodes(
  db: SuggestionRowsDb,
  conversion: { from: string; to: string }
): Promise<void> {
  const { from, to } = conversion;
  await db.updateCount(
    TRANSLATION_SUGGESTIONS_TABLE,
    { sourceLocale: to },
    { and: [{ column: "sourceLocale", op: "=", value: from }] }
  );
  const moving = await db.select<
    SuggestedDocument & SuggestionAge & { unitKey: string }
  >(TRANSLATION_SUGGESTIONS_TABLE, {
    columns: [
      "id",
      "scopeKind",
      "scopeSlug",
      "entryId",
      "unitKey",
      "createdAt",
    ],
    where: { and: [{ column: "targetLocale", op: "=", value: from }] },
  });
  for (const row of moving) {
    // Asked of the database, which is what its unique key compares by. Where it compares without
    // regard to case and the codes differ only by it, it answers with the row itself, which stands
    // in nothing's place.
    const found = await db.select<SuggestionAge>(
      TRANSLATION_SUGGESTIONS_TABLE,
      {
        columns: ["id", "createdAt"],
        where: {
          and: [
            ...documentConditions(row),
            { column: "targetLocale", op: "=", value: to },
            { column: "unitKey", op: "=", value: row.unitKey },
          ],
        },
      }
    );
    const standing = found.find(each => each.id !== row.id);
    if (standing !== undefined) {
      const kept = newerSuggestion<SuggestionAge>(row, standing);
      await removeRows(db, [kept.id === row.id ? standing.id : row.id]);
      if (kept.id !== row.id) continue;
    }
    await db.updateCount(
      TRANSLATION_SUGGESTIONS_TABLE,
      { targetLocale: to },
      { and: [{ column: "id", op: "=", value: row.id }] }
    );
  }
}
