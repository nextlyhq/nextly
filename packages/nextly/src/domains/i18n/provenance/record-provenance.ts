/**
 * Recording where each translated value came from, on the write's own transaction.
 *
 * Every write of a document's translatable values records one row per field it wrote, for the
 * language and part (live, or the language's working draft) it wrote: a fingerprint of the value,
 * its origin, and for a value made from another language, that language and the fingerprint of its
 * value then. A value in the default language, or one claimed `original`, is its own source and
 * never out of date. Any other takes its origin from the write's claim, or from who wrote it: a
 * person (or a plugin-defined one) as `person`, an API key as `integration`, the system as `import`.
 *
 * @experimental Until per-field provenance is complete.
 *
 * @module domains/i18n/provenance/record-provenance
 */
import { createHash, randomUUID } from "node:crypto";

import type {
  SupportedDialect,
  WhereClause,
  WhereCondition,
} from "@nextlyhq/adapter-drizzle/types";

import type { RequestActor } from "../../../auth/request-actor";
import {
  SOURCE_FINGERPRINT_MOVED,
  TRANSLATION_PROVENANCE_FIELD_PATH_LENGTH,
  TRANSLATION_PROVENANCE_ROW_SEPARATOR as ROW_PATH_SEPARATOR,
  TRANSLATION_PROVENANCE_TABLE,
  type ProvenanceOrigin,
  type ProvenancePartState,
  type ProvenanceScopeKind,
} from "../../../schemas/translation-provenance";
import { canonicalJson } from "../../../shared/lib/canonical-json";
import {
  tablePresence,
  type DashboardLogger,
  type TableProbe,
} from "../../dashboard/table-presence";
import {
  readLanguageRevisions,
  type SelectsRows,
} from "../../versions/document-revision";
import { languageCounterInVersion } from "../../versions/stale-version";

import {
  ownEntry,
  type ProvenanceClaim,
  type ProvenanceClaims,
} from "./provenance-claims";

/** The surface of a transaction recording reads and writes through. */
export interface ProvenanceDb {
  select<T = unknown>(
    table: string,
    options?: { where?: WhereClause; columns?: string[] }
  ): Promise<T[]>;
  insert<T = unknown>(table: string, data: Record<string, unknown>): Promise<T>;
  updateCount(
    table: string,
    data: Record<string, unknown>,
    where: WhereClause
  ): Promise<number>;
  delete(table: string, where: WhereClause): Promise<number>;
}

/** One write's translatable values, and what recording them needs. */
export interface ProvenanceWrite {
  scopeKind: ProvenanceScopeKind;
  scopeSlug: string;
  entryId: string;
  /** The language the values were written in. */
  locale: string;
  partState: ProvenancePartState;
  /** The values written, by field name. */
  values: Readonly<Record<string, unknown>>;
  /**
   * The fields among `values` whose storage is JSON, which some databases hand back as text: only
   * their text is read back to the value it encodes. Any other field's text is the value.
   */
  jsonFields?: ReadonlySet<string>;
  /**
   * Each of the document's languages' counters as they stand, read on the write's transaction:
   * what a copy's `sourceRevision` is compared with. Absent, no copy can be shown to come from
   * the source as it is.
   */
  languageRevisions?: ReadonlyMap<string, number>;
  /** The site's default language: the source every other language is made from. */
  defaultLocale: string;
  savedBy?: RequestActor;
  claims?: ProvenanceClaims;
  now?: Date;
}

/**
 * Whether the provenance table exists yet, asked once per database and remembered once found
 * (`tablePresence`). It reaches an installation through `nextly migrate`, so until then nothing is
 * recorded and every value reads as of unknown origin. A write asks `via` its own transaction's
 * connection before any statement against the table: on PostgreSQL a statement against a missing
 * table aborts the whole transaction, the write with it.
 */
const presenceByDb = new WeakMap<
  TableProbe,
  (via?: TableProbe) => Promise<boolean>
>();

export function translationProvenancePresent(
  db: TableProbe,
  logger?: DashboardLogger,
  via?: TableProbe
): Promise<boolean> {
  let present = presenceByDb.get(db);
  if (present === undefined) {
    present = tablePresence(
      db,
      TRANSLATION_PROVENANCE_TABLE,
      "Where translated values came from is not being recorded",
      logger
    );
    presenceByDb.set(db, present);
  }
  return present(via);
}

/**
 * A sha256 of a value as it was written, the same on every dialect. A write hands its values on
 * as the store will keep them, so each is read back to what it was first: a date as its ISO
 * string (canonical JSON would make every date `{}`), and, for a field whose storage is JSON
 * (`storedAsJson`), an object or array kept as text as the value it encodes (so its keys are put
 * in order, not compared as written). Any other text is the value itself: a text field holding
 * `[1, 2]` and then `[1,2]` has changed.
 */
export function valueFingerprint(value: unknown, storedAsJson = false): string {
  return createHash("sha256")
    .update(
      canonicalJson(writtenValueOf(value ?? null, storedAsJson)) ?? "",
      "utf8"
    )
    .digest("hex");
}

/** A stored value read back to the value written; see {@link valueFingerprint}. */
function writtenValueOf(value: unknown, storedAsJson: boolean): unknown {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (storedAsJson && typeof value === "string") {
    const text = value.trim();
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return value;
      }
    }
  }
  return value;
}

/**
 * Whether a copy was made from its source language as that language now stands: it says which
 * version of the source it read (`sourceRevision`), and the source's counter has not moved since.
 * A copy that does not say cannot be shown to, so it is not.
 */
function copiedFromCurrentSource(
  claim: Extract<ProvenanceClaim, { origin: "copy" }>,
  write: ProvenanceWrite
): boolean {
  if (claim.sourceRevision === undefined) return false;
  const now = write.languageRevisions?.get(claim.sourceLocale);
  return (
    now !== undefined &&
    languageCounterInVersion(claim.sourceRevision, claim.sourceLocale) === now
  );
}

/** The origin a write without a claim gives a value, from who wrote it. */
function originOfActor(savedBy: RequestActor | undefined): ProvenanceOrigin {
  if (savedBy?.type === "user" || savedBy?.type === "principal") {
    return "person";
  }
  if (savedBy?.type === "apiKey") return "integration";
  return "import";
}

/**
 * Who wrote the value, as the row keeps it. A plugin-defined person is kept by their kind alone,
 * never by their id, as a translation row keeps its last changer: the id may be an address, and
 * none is written where an erasure would have to find it.
 */
function actorColumns(savedBy: RequestActor | undefined): {
  actorKind: string | null;
  actorId: string | null;
  actorPrincipalKind: string | null;
} {
  if (savedBy === undefined) {
    return { actorKind: null, actorId: null, actorPrincipalKind: null };
  }
  if (savedBy.type === "principal") {
    return {
      actorKind: savedBy.type,
      actorId: null,
      actorPrincipalKind: savedBy.principal?.kind ?? null,
    };
  }
  return {
    actorKind: savedBy.type,
    actorId: savedBy.id ?? null,
    actorPrincipalKind: null,
  };
}

/** What one field's row says about where its value came from. */
interface FieldOrigin {
  origin: ProvenanceOrigin;
  engine: string | null;
  sourceLocale: string | null;
}

/** Where one field's value came from, by the write's language and the field's claim. */
function fieldOrigin(
  write: ProvenanceWrite,
  claim: ProvenanceClaim | undefined
): FieldOrigin {
  if (write.locale === write.defaultLocale || claim?.origin === "original") {
    return { origin: "original", engine: null, sourceLocale: null };
  }
  if (claim === undefined) {
    return {
      origin: originOfActor(write.savedBy),
      engine: null,
      sourceLocale: write.defaultLocale,
    };
  }
  return {
    origin: claim.origin,
    engine: claim.origin === "machine" ? claim.engine : null,
    sourceLocale:
      claim.origin === "copy" ? claim.sourceLocale : write.defaultLocale,
  };
}

/**
 * The fingerprint `field`'s value was made from: its source language's live one, or, for a copy
 * not made from the source as it now stands, {@link SOURCE_FINGERPRINT_MOVED}, which reads as out
 * of date until the value is made again from the source as it is.
 */
function sourceFingerprintOf(
  write: ProvenanceWrite,
  field: string,
  origin: FieldOrigin,
  sources: ReadonlyMap<string, ReadonlyMap<string, string>>
): string | null {
  if (origin.sourceLocale === null) return null;
  const claim = ownEntry(write.claims, field);
  if (claim?.origin === "copy" && !copiedFromCurrentSource(claim, write)) {
    return SOURCE_FINGERPRINT_MOVED;
  }
  return sources.get(origin.sourceLocale)?.get(field) ?? null;
}

/** The rows of one document's language and part, matched by these columns. */
function documentWhere(
  write: Pick<ProvenanceWrite, "scopeKind" | "scopeSlug" | "entryId">,
  locale: string,
  partState: ProvenancePartState
): { and: WhereCondition[] } {
  return {
    and: [
      { column: "scopeKind", op: "=", value: write.scopeKind },
      { column: "scopeSlug", op: "=", value: write.scopeSlug },
      { column: "entryId", op: "=", value: write.entryId },
      { column: "locale", op: "=", value: locale },
      { column: "partState", op: "=", value: partState },
    ],
  };
}

/** Each field's live value fingerprint in `locale`, as its rows record them. */
async function liveFingerprints(
  db: ProvenanceDb,
  write: ProvenanceWrite,
  locale: string
): Promise<Map<string, string>> {
  const rows = await db.select<{ fieldPath: string; valueFingerprint: string }>(
    TRANSLATION_PROVENANCE_TABLE,
    {
      columns: ["fieldPath", "valueFingerprint"],
      where: documentWhere(write, locale, "live"),
    }
  );
  return new Map(rows.map(row => [row.fieldPath, row.valueFingerprint]));
}

/**
 * Records where each value of `write` came from, on `db`, the write's own transaction: one row per
 * field, replacing the row the field had for the same language and part.
 *
 * @experimental
 */
async function recordTranslationProvenance(
  db: ProvenanceDb,
  write: ProvenanceWrite
): Promise<void> {
  const fields = Object.keys(write.values);
  if (fields.length === 0) return;
  const origins = new Map(
    fields.map(field => [
      field,
      fieldOrigin(write, ownEntry(write.claims, field)),
    ])
  );
  // Each source language's fingerprints, read once for every field made from it.
  const sources = new Map<string, Map<string, string>>();
  for (const { sourceLocale } of origins.values()) {
    if (sourceLocale !== null && !sources.has(sourceLocale)) {
      sources.set(
        sourceLocale,
        await liveFingerprints(db, write, sourceLocale)
      );
    }
  }
  const existing = new Map(
    (
      await db.select<{ id: string; fieldPath: string }>(
        TRANSLATION_PROVENANCE_TABLE,
        {
          columns: ["id", "fieldPath"],
          where: documentWhere(write, write.locale, write.partState),
        }
      )
    ).map(row => [row.fieldPath, row.id])
  );
  const writtenAt = write.now ?? new Date();
  const upsert = async (
    fieldPath: string,
    values: Record<string, unknown>
  ): Promise<void> => {
    const id = existing.get(fieldPath);
    if (id !== undefined) {
      await db.updateCount(TRANSLATION_PROVENANCE_TABLE, values, {
        and: [{ column: "id", op: "=", value: id }],
      });
      return;
    }
    await db.insert(TRANSLATION_PROVENANCE_TABLE, {
      id: randomUUID(),
      scopeKind: write.scopeKind,
      scopeSlug: write.scopeSlug,
      entryId: write.entryId,
      locale: write.locale,
      partState: write.partState,
      fieldPath,
      ...values,
    });
  };
  for (const [field, origin] of origins) {
    // A translation cleared has no value of its own: its language reads the field from another,
    // so it keeps no record that could put the language out of date. The default language keeps
    // its record, cleared or not: it is the source, and its translations follow it.
    if (
      write.locale !== write.defaultLocale &&
      isBlankValue(write.values[field])
    ) {
      const prefix = `${field}${ROW_PATH_SEPARATOR}`;
      const cleared = [...existing]
        .filter(([path]) => path === field || path.startsWith(prefix))
        .map(([, id]) => id);
      if (cleared.length > 0) {
        await db.delete(TRANSLATION_PROVENANCE_TABLE, {
          and: [{ column: "id", op: "IN", value: cleared }],
        });
      }
      continue;
    }
    const values = {
      valueFingerprint: valueFingerprint(
        write.values[field],
        write.jsonFields?.has(field) === true
      ),
      origin: origin.origin,
      engine: origin.engine,
      ...actorColumns(write.savedBy),
      sourceLocale: origin.sourceLocale,
      sourceFingerprint: sourceFingerprintOf(write, field, origin, sources),
      originRowId: null,
      writtenAt,
    };
    await upsert(field, values);
    await recordRowOrigins(db, {
      field,
      value: write.values[field],
      claim: ownEntry(write.claims, field),
      fieldValues: values,
      existing,
      upsert,
    });
  }
}

/**
 * The record of each row of a field with a structure per language (a translated repeater or
 * blocks field): one row per row id, under `<field>#<row id>`, naming the source row it was made
 * from (`originRowId`). A claim names each row's source row (`rows`); a copy keeps a row with no
 * named source as the row of the same id it copied. A row still in the value that the claim does
 * not name keeps the record it has, and a row no longer in it loses its record.
 */
async function recordRowOrigins(
  db: ProvenanceDb,
  args: {
    field: string;
    value: unknown;
    claim: ProvenanceClaim | undefined;
    fieldValues: Record<string, unknown>;
    existing: ReadonlyMap<string, string>;
    upsert: (
      fieldPath: string,
      values: Record<string, unknown>
    ) => Promise<void>;
  }
): Promise<void> {
  const prefix = `${args.field}${ROW_PATH_SEPARATOR}`;
  // A structure per language is stored as JSON: its value may arrive as text.
  const rows = rowsOf(writtenValueOf(args.value, true));
  const claimedRows =
    args.claim !== undefined && "rows" in args.claim
      ? (args.claim.rows ?? {})
      : {};
  for (const [rowId, row] of rows) {
    const fieldPath = `${prefix}${rowId}`;
    if (fieldPath.length > TRANSLATION_PROVENANCE_FIELD_PATH_LENGTH) continue;
    const originRowId =
      ownEntry(claimedRows, rowId) ??
      (args.claim?.origin === "copy" ? rowId : undefined);
    if (originRowId === undefined) continue;
    await args.upsert(fieldPath, {
      ...args.fieldValues,
      valueFingerprint: valueFingerprint(row, true),
      // A row's own source value is not recorded: its row is.
      sourceFingerprint: null,
      originRowId,
    });
  }
  const gone = [...args.existing]
    .filter(
      ([path]) =>
        path.startsWith(prefix) && !rows.has(path.slice(prefix.length))
    )
    .map(([, id]) => id);
  if (gone.length > 0) {
    await db.delete(TRANSLATION_PROVENANCE_TABLE, {
      and: [{ column: "id", op: "IN", value: gone }],
    });
  }
}

/** The rows of a structured value that carry an id, by id. */
function rowsOf(value: unknown): Map<string, unknown> {
  const rows = new Map<string, unknown>();
  if (!Array.isArray(value)) return rows;
  for (const row of value) {
    const id =
      typeof row === "object" && row !== null
        ? (row as { id?: unknown }).id
        : undefined;
    if (typeof id === "string" && id !== "") rows.set(id, row);
  }
  return rows;
}

/** One document's language whose working draft goes live. */
export interface ProvenancePromotion {
  scopeKind: ProvenanceScopeKind;
  scopeSlug: string;
  entryId: string;
  locale: string;
}

/**
 * Puts a language's working draft's provenance live, on `db`, the publish's own transaction: each
 * drafted field's live row gives way to the draft's, which keeps the origin the draft was saved
 * with, so a value claimed on a held save keeps its claim once it is published. Answers the fields
 * it moved: a value going live that its draft recorded nothing for is the caller's to record.
 *
 * @experimental
 */
async function promoteDraftProvenance(
  db: ProvenanceDb,
  promotion: ProvenancePromotion
): Promise<ReadonlySet<string>> {
  const drafted = (
    await db.select<{ fieldPath: string }>(TRANSLATION_PROVENANCE_TABLE, {
      columns: ["fieldPath"],
      where: documentWhere(promotion, promotion.locale, "draft"),
    })
  ).map(row => row.fieldPath);
  if (drafted.length === 0) return new Set();
  // Each drafted field's live records give way, its rows' records included: a row the draft no
  // longer has has no record in the draft, and its live one would outlive the row.
  const draftedFields = new Set(
    drafted.filter(path => !path.includes(ROW_PATH_SEPARATOR))
  );
  const live = await db.select<{ id: string; fieldPath: string }>(
    TRANSLATION_PROVENANCE_TABLE,
    {
      columns: ["id", "fieldPath"],
      where: documentWhere(promotion, promotion.locale, "live"),
    }
  );
  const replaced = live
    .filter(
      row =>
        drafted.includes(row.fieldPath) ||
        draftedFields.has(row.fieldPath.split(ROW_PATH_SEPARATOR)[0])
    )
    .map(row => row.id);
  if (replaced.length > 0) {
    await db.delete(TRANSLATION_PROVENANCE_TABLE, {
      and: [{ column: "id", op: "IN", value: replaced }],
    });
  }
  await db.updateCount(
    TRANSLATION_PROVENANCE_TABLE,
    { partState: "live" },
    documentWhere(promotion, promotion.locale, "draft")
  );
  return new Set(drafted);
}

/**
 * The document's languages' counters as they stand, read on `db` (the write's transaction) when a
 * write claims a copy, for {@link ProvenanceWrite.languageRevisions}; undefined when none does, or
 * when the document keeps no translations to count.
 */
export async function copySourceRevisions(
  db: SelectsRows,
  args: {
    dialect: SupportedDialect;
    languagesTable: string | null;
    entryId: string;
    claims: ProvenanceClaims | undefined;
  }
): Promise<ReadonlyMap<string, number> | undefined> {
  const copies = Object.values(args.claims ?? {}).some(
    claim => claim.origin === "copy"
  );
  if (!copies || args.languagesTable === null) return undefined;
  const counters = await readLanguageRevisions(db, {
    dialect: args.dialect,
    table: args.languagesTable,
    ids: [args.entryId],
  });
  // A language with no translation row yet holds no counter: it reads as 0, as a version does.
  return counters.get(args.entryId) ?? new Map<string, number>();
}

/** A write's values and, where it puts a held draft live, that it does. */
export interface WrittenValues extends ProvenanceWrite {
  /** The write puts the language's held draft live: the draft's record moves with it. */
  promotesDraft?: boolean;
}

/**
 * Records what one write put down, on `db`, the write's own transaction. A write putting a held
 * draft live moves the draft's own record (`promoteDraftProvenance`), so a claim made on the held
 * save is kept; a value it recorded nothing for (a draft held before recording began) is recorded
 * as this write's, like any other.
 *
 * @experimental
 */
export async function recordWrittenValues(
  db: ProvenanceDb,
  write: WrittenValues
): Promise<void> {
  let values = write.values;
  if (write.promotesDraft === true) {
    const moved = await promoteDraftProvenance(db, write);
    // The draft's values are the whole language, untouched fields included: a field the draft
    // recorded nothing for keeps the live record it has while its value is the one that record
    // describes. A value the draft changed with no record of its own (a draft held before
    // recording began) is recorded as this write's, so the live record never describes the value
    // it replaced; a blank one never is.
    const live = await liveFingerprints(db, write, write.locale);
    values = Object.fromEntries(
      Object.entries(values).filter(([field, value]) => {
        if (moved.has(field) || isBlankValue(value)) return false;
        const recorded = live.get(field);
        return (
          recorded === undefined ||
          recorded !==
            valueFingerprint(value, write.jsonFields?.has(field) === true)
        );
      })
    );
  }
  await recordTranslationProvenance(db, { ...write, values });
}

/** A value that holds nothing translated: absent, null or an empty string. */
function isBlankValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Moves one entity's records of a renamed translated field to its new name, on `db`: the field's
 * own records, and each row's record in a field with a structure per language (`<field>#<row id>`).
 * A record is kept by field name, so left under the old one every value of the renamed field would
 * read as of unknown origin, and none could be found out of date. A row's record whose new path
 * no longer fits the column is dropped, as recording skips one. Nothing is done until the table is
 * there.
 *
 * @experimental
 */
export async function renameFieldProvenance(
  db: ProvenanceDb & { tableExists(table: string): Promise<boolean> },
  rename: {
    scopeKind: ProvenanceScopeKind;
    scopeSlug: string;
    from: string;
    to: string;
  }
): Promise<void> {
  if (rename.from === rename.to) return;
  if (!(await db.tableExists(TRANSLATION_PROVENANCE_TABLE))) return;
  const scope: WhereCondition[] = [
    { column: "scopeKind", op: "=", value: rename.scopeKind },
    { column: "scopeSlug", op: "=", value: rename.scopeSlug },
  ];
  await db.updateCount(
    TRANSLATION_PROVENANCE_TABLE,
    { fieldPath: rename.to },
    { and: [...scope, { column: "fieldPath", op: "=", value: rename.from }] }
  );
  // A row's path is the field's with the row id after it. LIKE narrows the read; the prefix is
  // checked again here, since a field name may hold `_`, which LIKE takes as any character.
  const prefix = `${rename.from}${ROW_PATH_SEPARATOR}`;
  const rows = await db.select<{ id: string; fieldPath: string }>(
    TRANSLATION_PROVENANCE_TABLE,
    {
      columns: ["id", "fieldPath"],
      where: {
        and: [
          ...scope,
          { column: "fieldPath", op: "LIKE", value: `${prefix}%` },
        ],
      },
    }
  );
  for (const row of rows) {
    if (!row.fieldPath.startsWith(prefix)) continue;
    const moved = `${rename.to}${ROW_PATH_SEPARATOR}${row.fieldPath.slice(prefix.length)}`;
    const where = { and: [{ column: "id", op: "=" as const, value: row.id }] };
    if (moved.length > TRANSLATION_PROVENANCE_FIELD_PATH_LENGTH) {
      await db.delete(TRANSLATION_PROVENANCE_TABLE, where);
      continue;
    }
    await db.updateCount(
      TRANSLATION_PROVENANCE_TABLE,
      { fieldPath: moved },
      where
    );
  }
}

/**
 * Removes a language's working draft's provenance, on `db`, the discard's own transaction: the
 * draft is gone, and what it said about its values with it.
 *
 * @experimental
 */
export async function discardDraftProvenance(
  db: ProvenanceDb,
  draft: ProvenancePromotion
): Promise<void> {
  await db.delete(
    TRANSLATION_PROVENANCE_TABLE,
    documentWhere(draft, draft.locale, "draft")
  );
}

/**
 * Removes every row a deleted document had, on `db`, the delete's own transaction: in every
 * language and part, so nothing is left to read as the provenance of a document that is gone.
 *
 * @experimental
 */
export async function forgetDocumentProvenance(
  db: Pick<ProvenanceDb, "delete">,
  document: Pick<ProvenanceWrite, "scopeKind" | "scopeSlug" | "entryId">
): Promise<void> {
  await db.delete(TRANSLATION_PROVENANCE_TABLE, {
    and: [
      { column: "scopeKind", op: "=", value: document.scopeKind },
      { column: "scopeSlug", op: "=", value: document.scopeSlug },
      { column: "entryId", op: "=", value: document.entryId },
    ],
  });
}
