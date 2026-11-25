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
import { randomUUID } from "node:crypto";

import type {
  SupportedDialect,
  WhereClause,
  WhereCondition,
} from "@nextlyhq/adapter-drizzle/types";
import { walkNodes, type BlockNode } from "@nextlyhq/blocks-engine";

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
import {
  tablePresence,
  type DashboardLogger,
  type TableProbe,
} from "../../dashboard/table-presence";
import { quoteIdent } from "../../schema/pipeline/sql-templates/identifier-quoting";
import { quoteSqlLiteral } from "../../schema/utils/sql-literal";
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
import {
  fieldOfPath,
  keepSources,
  pruneSources,
  unrecordedSources,
  type RecordedSource,
  type SourceTextDb,
  type WriteSources,
} from "./source-text";
import { recordUnknownOrigin } from "./unknown-origin";
import { valueFingerprint, writtenValueOf } from "./value-fingerprint";

export { valueFingerprint };

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
  /**
   * Where the source text translations are made from is read and kept. Absent (a write in the
   * default language, which is a source and made from none), none is.
   */
  sources?: WriteSources;
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
 * field, replacing the row the field had for the same language and part. A value the write leaves
 * as it was keeps the record it has (`judgeWritten`).
 *
 * The source text of each translation recorded is kept beside it, and a version of it no record
 * names any more goes (`source-text`).
 *
 * @experimental
 */
async function recordTranslationProvenance(
  db: ProvenanceDb,
  write: ProvenanceWrite
): Promise<void> {
  const fields = Object.keys(write.values);
  if (fields.length === 0) return;
  const existing = await recordedPaths(db, write);
  const { forgotten, changed } = await judgeWritten(db, write, existing);
  for (const field of forgotten) await forgetField(db, field, existing);
  const made = await recordChanged(db, write, changed, existing);
  if (write.locale === write.defaultLocale || write.sources?.kept !== true) {
    return;
  }
  await keepSources(write.sources, documentOf(write), made, writtenAt(write));
  await pruneSources(write.sources.db, documentOf(write), [
    ...forgotten,
    ...changed,
  ]);
}

/** The document a write is of. */
function documentOf(
  write: Pick<ProvenanceWrite, "scopeKind" | "scopeSlug" | "entryId">
): Pick<ProvenanceWrite, "scopeKind" | "scopeSlug" | "entryId"> {
  const { scopeKind, scopeSlug, entryId } = write;
  return { scopeKind, scopeSlug, entryId };
}

/** When a write's values were written. */
function writtenAt(write: ProvenanceWrite): Date {
  return write.now ?? new Date();
}

/** The fingerprint of the value a write gives `field`. */
function writtenFingerprint(write: ProvenanceWrite, field: string): string {
  return valueFingerprint(
    write.values[field],
    write.jsonFields?.has(field) === true
  );
}

/**
 * Which of a write's fields lose their record and which are recorded. Every other keeps the record
 * it has: a write sends fields it does not change, and one sent as it was is neither made again by
 * whoever saves nor brought up to date with a source nobody looked at. A write that says where an
 * unchanged value came from (its claim) is recorded.
 *
 * - A translation cleared has no value of its own: its language reads the field from another, so
 *   it keeps no record that could put the language out of date. The default language keeps its
 *   record, cleared or not: it is the source, and its translations follow it.
 * - A held value that is the live one again is no change of its own: its draft's record goes, and
 *   the live one stands when the draft is published.
 */
async function judgeWritten(
  db: ProvenanceDb,
  write: ProvenanceWrite,
  existing: ReadonlyMap<string, RecordedPath>
): Promise<{ forgotten: string[]; changed: string[] }> {
  const live =
    write.partState === "draft"
      ? await liveFingerprints(db, write, write.locale)
      : undefined;
  const forgotten: string[] = [];
  const changed: string[] = [];
  for (const field of Object.keys(write.values)) {
    if (
      write.locale !== write.defaultLocale &&
      isBlankValue(write.values[field])
    ) {
      forgotten.push(field);
      continue;
    }
    if (ownEntry(write.claims, field) !== undefined) {
      changed.push(field);
      continue;
    }
    const fingerprint = writtenFingerprint(write, field);
    if (existing.get(field)?.valueFingerprint === fingerprint) continue;
    if (live?.get(field) === fingerprint) forgotten.push(field);
    else changed.push(field);
  }
  return { forgotten, changed };
}

/**
 * Records `fields` of a write, and answers the source each one's record names by a fingerprint of
 * its value.
 */
async function recordChanged(
  db: ProvenanceDb,
  write: ProvenanceWrite,
  fields: readonly string[],
  existing: ReadonlyMap<string, RecordedPath>
): Promise<Map<string, RecordedSource>> {
  const made = new Map<string, RecordedSource>();
  if (fields.length === 0) return made;
  const origins = new Map(
    fields.map(field => [
      field,
      fieldOrigin(write, ownEntry(write.claims, field)),
    ])
  );
  const sources = await sourceFingerprints(db, write, origins);
  await recordUnrecordedSources(write, origins, sources);
  const upsert = upsertInto(db, write, existing);
  const now = writtenAt(write);
  for (const [field, origin] of origins) {
    const sourceFingerprint = sourceFingerprintOf(
      write,
      field,
      origin,
      sources
    );
    const values = {
      valueFingerprint: writtenFingerprint(write, field),
      origin: origin.origin,
      engine: origin.engine,
      ...actorColumns(write.savedBy),
      sourceLocale: origin.sourceLocale,
      sourceFingerprint,
      originRowId: null,
      writtenAt: now,
    };
    await upsert(field, values);
    if (
      origin.sourceLocale !== null &&
      sourceFingerprint !== null &&
      sourceFingerprint !== SOURCE_FINGERPRINT_MOVED
    ) {
      made.set(field, {
        sourceLocale: origin.sourceLocale,
        fingerprint: sourceFingerprint,
      });
    }
    await recordRowOrigins(db, {
      field,
      value: write.values[field],
      claim: ownEntry(write.claims, field),
      fieldValues: values,
      existing,
      upsert,
    });
  }
  return made;
}

/**
 * The fields of `origins` made from a source value no record describes, each with that source's
 * language. A copy that cannot be shown to be of the source as it stands names no version of it,
 * so there is none to record: recorded, the source would put the copy out of date at once.
 */
function sourcesWithNoRecord(
  write: ProvenanceWrite,
  origins: ReadonlyMap<string, FieldOrigin>,
  sources: ReadonlyMap<string, ReadonlyMap<string, string>>
): Map<string, string> {
  const unrecorded = new Map<string, string>();
  for (const [field, { sourceLocale }] of origins) {
    if (sourceLocale === null || sources.get(sourceLocale)?.has(field)) {
      continue;
    }
    const claim = ownEntry(write.claims, field);
    if (claim?.origin === "copy" && !copiedFromCurrentSource(claim, write)) {
      continue;
    }
    unrecorded.set(field, sourceLocale);
  }
  return unrecorded;
}

/**
 * Records each source value no record describes (written before origins were recorded) that a
 * field of `origins` is now made from, as of unknown origin, and adds its fingerprint to
 * `sources`: a translation made from it is then found out of date once it changes, rather than
 * read as made from an unknown source for good.
 */
async function recordUnrecordedSources(
  write: ProvenanceWrite,
  origins: ReadonlyMap<string, FieldOrigin>,
  sources: Map<string, Map<string, string>>
): Promise<void> {
  if (write.sources === undefined) return;
  const unrecorded = sourcesWithNoRecord(write, origins, sources);
  if (unrecorded.size === 0) return;
  const found = await unrecordedSources(write.sources, unrecorded);
  for (const [sourceLocale, values] of found) {
    for (const [fieldPath, fingerprint] of values) {
      await recordUnknownOrigin(
        write.sources.db,
        documentOf(write),
        {
          locale: sourceLocale,
          fieldPath,
          valueFingerprint: fingerprint,
          sourceLocale: null,
          sourceFingerprint: null,
        },
        writtenAt(write)
      );
    }
    sources.set(
      sourceLocale,
      new Map([...values, ...(sources.get(sourceLocale) ?? [])])
    );
  }
}

/** Each source language's live fingerprints, read once for every field made from it. */
async function sourceFingerprints(
  db: ProvenanceDb,
  write: ProvenanceWrite,
  origins: ReadonlyMap<string, FieldOrigin>
): Promise<Map<string, Map<string, string>>> {
  const sources = new Map<string, Map<string, string>>();
  for (const { sourceLocale } of origins.values()) {
    if (sourceLocale !== null && !sources.has(sourceLocale)) {
      sources.set(
        sourceLocale,
        await liveFingerprints(db, write, sourceLocale)
      );
    }
  }
  return sources;
}

/** A record a language and part already has. */
interface RecordedPath {
  id: string;
  valueFingerprint: string;
}

/** The records the write's language and part already has, by path. */
async function recordedPaths(
  db: ProvenanceDb,
  write: ProvenanceWrite
): Promise<Map<string, RecordedPath>> {
  const rows = await db.select<RecordedPath & { fieldPath: string }>(
    TRANSLATION_PROVENANCE_TABLE,
    {
      columns: ["id", "fieldPath", "valueFingerprint"],
      where: documentWhere(write, write.locale, write.partState),
    }
  );
  return new Map(
    rows.map(({ id, fieldPath, valueFingerprint: value }) => [
      fieldPath,
      { id, valueFingerprint: value },
    ])
  );
}

/**
 * Writes one record of `write`'s language and part: over the one `existing` names for its path,
 * or as a new one.
 */
function upsertInto(
  db: ProvenanceDb,
  write: ProvenanceWrite,
  existing: ReadonlyMap<string, RecordedPath>
): (fieldPath: string, values: Record<string, unknown>) => Promise<void> {
  return async (fieldPath, values) => {
    const id = existing.get(fieldPath)?.id;
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
}

/** Removes `field`'s record and its rows' records, of those `existing` names. */
async function forgetField(
  db: ProvenanceDb,
  field: string,
  existing: ReadonlyMap<string, RecordedPath>
): Promise<void> {
  const prefix = `${field}${ROW_PATH_SEPARATOR}`;
  const forgotten = [...existing]
    .filter(([path]) => path === field || path.startsWith(prefix))
    .map(([, { id }]) => id);
  if (forgotten.length === 0) return;
  await db.delete(TRANSLATION_PROVENANCE_TABLE, {
    and: [{ column: "id", op: "IN", value: forgotten }],
  });
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
    existing: ReadonlyMap<string, RecordedPath>;
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
    .map(([, { id }]) => id);
  if (gone.length > 0) {
    await db.delete(TRANSLATION_PROVENANCE_TABLE, {
      and: [{ column: "id", op: "IN", value: gone }],
    });
  }
}

/**
 * The rows of a structured value that carry an id, by id: a repeater's items, or a block
 * document's nodes, a container's nested nodes included, read with the one walk every block
 * reader takes (`walkNodes`).
 */
function rowsOf(value: unknown): Map<string, unknown> {
  const rows = new Map<string, unknown>();
  const keep = (row: unknown) => {
    const id =
      typeof row === "object" && row !== null
        ? (row as { id?: unknown }).id
        : undefined;
    if (typeof id === "string" && id !== "") rows.set(id, row);
  };
  if (Array.isArray(value)) {
    for (const row of value) keep(row);
    return rows;
  }
  const nodes =
    typeof value === "object" && value !== null
      ? (value as { nodes?: unknown }).nodes
      : undefined;
  // The walk skips an entry that is no node, as every reader of a stored document does.
  if (Array.isArray(nodes)) walkNodes(nodes as BlockNode[], keep);
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
 * with, so a value claimed on a held save keeps its claim once it is published. A value going live
 * that no record then describes is the caller's to record. Answers the fields whose records moved.
 *
 * @experimental
 */
async function promoteDraftProvenance(
  db: ProvenanceDb,
  promotion: ProvenancePromotion
): Promise<string[]> {
  const drafted = (
    await db.select<{ fieldPath: string }>(TRANSLATION_PROVENANCE_TABLE, {
      columns: ["fieldPath"],
      where: documentWhere(promotion, promotion.locale, "draft"),
    })
  ).map(row => row.fieldPath);
  if (drafted.length === 0) return [];
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
  return [...draftedFields];
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
    const promoted = await promoteDraftProvenance(db, write);
    const cleared = await forgetCleared(db, write);
    // The live records that went, cleared or with the draft's in their place, may have been the
    // last to name their source.
    if (write.sources?.kept === true) {
      await pruneSources(write.sources.db, documentOf(write), [
        ...promoted,
        ...cleared,
      ]);
    }
    // The draft's values are the whole language, untouched fields included, and the publish may
    // give a field a value of its own over the draft's. Read once the draft's records are live: a
    // field keeps its live record (the draft's, with its claim, or the one it had) while its value
    // is the one that record describes. A value no record describes (one the publish gave, or one
    // a draft held before recording began changed) is recorded as this write's, so a live record
    // never describes a value it replaced; a blank one never is.
    const live = await liveFingerprints(db, write, write.locale);
    values = Object.fromEntries(
      Object.entries(values).filter(([field, value]) => {
        if (isBlankValue(value)) return false;
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

/**
 * Forgets the live record of each translation a published draft cleared, and answers those fields.
 * A cleared value has no record in the draft to put live, so nothing else takes the place of the
 * one that describes the value it replaced. A field the publish does not write has no value here.
 */
async function forgetCleared(
  db: ProvenanceDb,
  write: ProvenanceWrite
): Promise<string[]> {
  if (write.locale === write.defaultLocale) return [];
  const cleared = Object.keys(write.values).filter(
    field =>
      write.values[field] !== undefined && isBlankValue(write.values[field])
  );
  if (cleared.length === 0) return [];
  const existing = await recordedPaths(db, { ...write, partState: "live" });
  for (const field of cleared) await forgetField(db, field, existing);
  return cleared;
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
 * The statements that move one entity's records of a renamed translated field by hand, as
 * `renameFieldProvenance` moves them, in `records`: the provenance table, or another keyed by the
 * same columns. The field's own records; then each row's record whose new path would not fit the
 * column is deleted, as the move drops it; then each other row's record under the field's name and
 * the row separator is moved. Text for a developer finishing a rename whose move failed, never run
 * here.
 *
 * @experimental
 */
export function renameFieldProvenanceStatements(
  dialect: SupportedDialect,
  rename: {
    scopeKind: ProvenanceScopeKind;
    scopeSlug: string;
    from: string;
    to: string;
  },
  records: string = TRANSLATION_PROVENANCE_TABLE
): string[] {
  const id = (name: string) => quoteIdent(name, dialect);
  const text = (value: string) => quoteSqlLiteral(value, dialect);
  const mysql = dialect === "mysql";
  const table = id(records);
  const path = id("field_path");
  const scope = `${id("scope_kind")} = ${text(rename.scopeKind)} AND ${id("scope_slug")} = ${text(rename.scopeSlug)}`;
  const prefix = `${rename.from}${ROW_PATH_SEPARATOR}`;
  const substring = mysql ? "SUBSTRING" : "SUBSTR";
  const rest = `${substring}(${path}, ${String(prefix.length + 1)})`;
  const newPrefix = text(`${rename.to}${ROW_PATH_SEPARATOR}`);
  const moved = mysql
    ? `CONCAT(${newPrefix}, ${rest})`
    : `${newPrefix} || ${rest}`;
  const underPrefix = `${scope} AND ${substring}(${path}, 1, ${String(prefix.length)}) = ${text(prefix)}`;
  // A row's new path is its old one with the field's name changed, so it fits the column while the
  // old one is at most this long. Characters, not bytes: MySQL's LENGTH counts bytes.
  const longestKept =
    TRANSLATION_PROVENANCE_FIELD_PATH_LENGTH +
    prefix.length -
    `${rename.to}${ROW_PATH_SEPARATOR}`.length;
  const length = mysql ? "CHAR_LENGTH" : "LENGTH";
  return [
    `UPDATE ${table} SET ${path} = ${text(rename.to)} WHERE ${scope} AND ${path} = ${text(rename.from)};`,
    `DELETE FROM ${table} WHERE ${underPrefix} AND ${length}(${path}) > ${String(longestKept)};`,
    `UPDATE ${table} SET ${path} = ${moved} WHERE ${underPrefix};`,
  ];
}

/**
 * Removes a language's working draft's provenance, on `db`, the discard's own transaction: the
 * draft is gone, and what it said about its values with it. With `sources` (where the table that
 * keeps source text is there), the text the draft alone was made from goes too.
 *
 * @experimental
 */
export async function discardDraftProvenance(
  db: ProvenanceDb,
  draft: ProvenancePromotion,
  sources?: Pick<SourceTextDb, "select" | "delete">
): Promise<void> {
  const where = documentWhere(draft, draft.locale, "draft");
  const fields =
    sources === undefined
      ? []
      : (
          await db.select<{ fieldPath: string }>(TRANSLATION_PROVENANCE_TABLE, {
            columns: ["fieldPath"],
            where,
          })
        ).map(row => fieldOfPath(row.fieldPath));
  await db.delete(TRANSLATION_PROVENANCE_TABLE, where);
  if (sources !== undefined) {
    await pruneSources(sources, documentOf(draft), [...new Set(fields)]);
  }
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

/**
 * Removes, in every language, the live record of each row a write removed from a repeater's one
 * structure (`<field>#<row id>` for a row no longer in `structure`), on `db`, the write's own
 * transaction. A structure is one for every language, so removing a row removes it from every
 * language at once: its record goes with it everywhere, as its text does
 * (`pruneOverlaysOfRemovedRows`), rather than lingering as the record of a row a language no
 * longer has. A held draft's records are its own, and go live or are discarded with it.
 *
 * @experimental
 */
export async function forgetRemovedRowsProvenance(
  db: Pick<ProvenanceDb, "select" | "delete">,
  document: Pick<ProvenanceWrite, "scopeKind" | "scopeSlug" | "entryId">,
  written: ReadonlyArray<{
    /** The field's name, which its records' paths begin with. */
    field: string;
    /** The structure written, as stored (JSON text allowed). */
    structure: unknown;
    kind: "repeater" | "group";
  }>
): Promise<void> {
  // Only a repeater's structure has rows; a group's records are the field's own.
  const lists = written.filter(entry => entry.kind === "repeater");
  if (lists.length === 0) return;
  const records = await db.select<{ id: string; fieldPath: string }>(
    TRANSLATION_PROVENANCE_TABLE,
    {
      columns: ["id", "fieldPath"],
      where: {
        and: [
          { column: "scopeKind", op: "=", value: document.scopeKind },
          { column: "scopeSlug", op: "=", value: document.scopeSlug },
          { column: "entryId", op: "=", value: document.entryId },
          { column: "partState", op: "=", value: "live" },
        ],
      },
    }
  );
  const gone = lists.flatMap(({ field, structure }) => {
    const prefix = `${field}${ROW_PATH_SEPARATOR}`;
    const rows = rowsOf(writtenValueOf(structure, true));
    return records
      .filter(
        record =>
          record.fieldPath.startsWith(prefix) &&
          !rows.has(record.fieldPath.slice(prefix.length))
      )
      .map(record => record.id);
  });
  if (gone.length === 0) return;
  await db.delete(TRANSLATION_PROVENANCE_TABLE, {
    and: [{ column: "id", op: "IN", value: gone }],
  });
}
