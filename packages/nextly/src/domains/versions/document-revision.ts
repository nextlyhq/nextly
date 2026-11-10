/**
 * A document's version, as the server stores it and as a client receives it.
 *
 * Stored as counters: one on the document's own row (`_revision`), covering its
 * shared fields, lifecycle, components, relations and held working draft, and
 * one on each translation row, covering that language's translated fields and
 * its status. A save increments the counters of the rows it changes, in the
 * same statement and transaction as the change.
 *
 * Published as one opaque string, `_rev`, that names every counter it covers,
 * so a client hands back exactly what it read and the server can tell which
 * part moved. A state has one spelling: languages are sorted, and a language
 * with no translation row is spelled 0 rather than left out.
 *
 * @module domains/versions/document-revision
 */

import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";
import { inArray, sql } from "drizzle-orm";

import type { RequestActor } from "../../auth/request-actor";
import { NextlyError } from "../../errors/nextly-error";
import {
  DOCUMENT_OVERWRITE_KEY,
  DOCUMENT_VERSION_KEY,
  MIGRATE_STEP_COLUMN_NAMES,
} from "../../lib/system-columns";
import { contentEventActor } from "../content-events/actor";
import type { SanitizedLocalizationConfig } from "../i18n/config/types";
import { isLocaleSelector } from "../i18n/locale-selector";
import { resolveRequestedLocale } from "../i18n/resolve-locale";
import {
  languageRevisionTable,
  systemColumnDriverValue,
} from "../schema/services/runtime-schema-generator";

export { DOCUMENT_OVERWRITE_KEY, DOCUMENT_VERSION_KEY };

/** The column holding a row's counter, on every content and translation table. */
export const DOCUMENT_REVISION_COLUMN = "_revision";

/**
 * The published version for a main counter and the language counters a read covers.
 *
 * `languages` absent: a document with no translations, or a write that touched
 * none. A language mapped to 0 has no translation row.
 */
export function encodeDocumentVersion(
  main: number,
  languages?: Readonly<Record<string, number>>
): string {
  const codes = Object.keys(languages ?? {}).sort();
  if (codes.length === 0) return String(main);
  // `.`, `:` and `,` appear in no language code (`pt-BR` included), so the
  // string splits back into its parts unambiguously.
  return `${main}.${codes.map(code => `${code}:${languages![code]}`).join(",")}`;
}

/**
 * Every key a request body may carry that only the server writes: the
 * published version and the per-document columns.
 *
 * The published key is not a column, so the system-column lists that close
 * columns to clients never name it; a client that saves back what it read
 * sends it, and it must be dropped before the body reaches any column.
 */
const SERVER_ONLY_KEYS: readonly string[] = [
  DOCUMENT_VERSION_KEY,
  DOCUMENT_OVERWRITE_KEY,
  ...MIGRATE_STEP_COLUMN_NAMES,
];

/**
 * A write's body without the version and the per-document columns. A copy,
 * so the caller's object is left as it was; the same object when it carries
 * none of them.
 *
 * Dropped rather than refused: a client re-saving the document it read is the
 * ordinary case, and must not fail.
 */
export function withoutDocumentVersionKeys<T extends Record<string, unknown>>(
  body: T
): T {
  if (!SERVER_ONLY_KEYS.some(key => key in body)) return body;
  const out = { ...body };
  for (const key of SERVER_ONLY_KEYS) delete out[key];
  return out;
}

/**
 * A stored counter as a number: drivers return integers as numbers, or as
 * strings where the value could exceed a JavaScript number.
 *
 * A row read without its counter is a read that selected too little, never a
 * version: guessing one would publish a version no save produced.
 */
export function revisionOf(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n === "number" && Number.isInteger(n)) return n;
  throw NextlyError.internal({
    logContext: {
      reason: "document-revision-unreadable",
      value: String(value),
    },
  });
}

/**
 * The last-changer columns for a save made by `actor`, spelled as content
 * events spell an actor: a kind, an id, and a plugin-defined person's kind.
 * Ids only — a name is looked up when one is shown.
 *
 * A plugin-defined person is kept by their kind alone, never their id. A
 * plugin's id for a person may be an address, and the erasure that replaces
 * it when the plugin reports the person deleted visits the audit trail and
 * content history, not content rows; an id never written here is one nothing
 * has to find. A staff user's id and an API key's are the install's own.
 */
export function changerColumns(
  actor: RequestActor
): Record<string, string | null> {
  const event = contentEventActor(actor, null);
  return {
    _changed_by_kind: event.kind,
    _changed_by_id:
      event.kind === "system" || event.kind === "principal" ? null : event.id,
    _changed_by_principal_kind:
      event.kind === "principal" ? event.principalKind : null,
  };
}

/** The column holding when a row's counter last moved. */
export const CHANGED_AT_COLUMN = "_changed_at";

/**
 * What one save adds to the UPDATE of a document's own row: the counter
 * incremented by the database, the changer, and when — `at`, the same moment
 * the save writes to `updated_at` when it writes one, so the two compare
 * equal. The row's runtime model declares the column, so it stores the value
 * exactly as it stores `updated_at`.
 *
 * The increment is an expression, never a value computed from a read, so two
 * saves can never both write the same next version: the row lock the UPDATE
 * takes orders them, and each adds one to what the other committed.
 */
export function revisionBumpColumns(
  actor: RequestActor,
  at: Date = new Date()
): Record<string, unknown> {
  return {
    [DOCUMENT_REVISION_COLUMN]: sql`${sql.identifier(DOCUMENT_REVISION_COLUMN)} + 1`,
    ...changerColumns(actor),
    [CHANGED_AT_COLUMN]: at,
  };
}

/**
 * The changer and the time for a translation row a save writes, without the
 * counter: for a row being inserted, which takes the counter's default.
 *
 * Encoded here because a translation table's runtime model does not declare
 * the column: stored as the main table's `_changed_at` is, by the same column
 * builder, never as a driver binds a bare `Date`.
 */
export function translationChangeColumns(
  actor: RequestActor,
  dialect: SupportedDialect,
  at: Date = new Date()
): Record<string, unknown> {
  return {
    ...changerColumns(actor),
    [CHANGED_AT_COLUMN]: systemColumnDriverValue(
      dialect,
      CHANGED_AT_COLUMN,
      at
    ),
  };
}

/** {@link revisionBumpColumns} for an UPDATE of translation rows. */
export function translationRevisionBumpColumns(
  actor: RequestActor,
  dialect: SupportedDialect,
  at: Date = new Date()
): Record<string, unknown> {
  return {
    [DOCUMENT_REVISION_COLUMN]: sql`${sql.identifier(DOCUMENT_REVISION_COLUMN)} + 1`,
    ...translationChangeColumns(actor, dialect, at),
  };
}

/**
 * Increment a row's counter on its own, for a save that writes nothing else
 * to that row: a held working draft, a status moved only on translation rows,
 * a change to components or relations alone. `updated_at` is left as it is,
 * since the row's own content did not change.
 *
 * `at` is when it changed: the moment the same save wrote to `updated_at`,
 * when it wrote one in another statement, so the two compare equal.
 */
export async function bumpDocumentRevision(
  tx: Pick<TransactionContext, "update">,
  table: string,
  where: Record<string, string>,
  actor: RequestActor,
  at: Date = new Date()
): Promise<void> {
  await tx.update(table, revisionBumpColumns(actor, at), {
    and: Object.entries(where).map(([column, value]) => ({
      column,
      op: "=" as const,
      value,
    })),
  });
}

/**
 * The counters a document holds, read on `tx`: its own row's, and each named
 * language's (0 for a language with no translation row).
 *
 * Read inside the write's transaction, after the write, so a save reports the
 * version it produced. A read after the commit can see a later save's.
 */
async function readDocumentRevisions(
  tx: Pick<TransactionContext, "select" | "getDrizzle">,
  args: {
    dialect: SupportedDialect;
    table: string;
    id: string;
    /** The translation table and the languages to report, when any. */
    languages?: { table: string; locales: readonly string[] };
  }
): Promise<{ main: number; languages?: Record<string, number> } | undefined> {
  const [row] = await tx.select<Record<string, unknown>>(args.table, {
    columns: [DOCUMENT_REVISION_COLUMN],
    where: { and: [{ column: "id", op: "=", value: args.id }] },
    limit: 1,
  });
  // The document is gone — deleted while this write waited for its lock. The
  // write answers that itself; there is no version to report.
  if (!row) return undefined;
  const main = revisionOf(row[DOCUMENT_REVISION_COLUMN]);
  if (!args.languages || args.languages.locales.length === 0) return { main };
  const byDocument = await readLanguageRevisions(tx.getDrizzle<SelectsRows>(), {
    dialect: args.dialect,
    table: args.languages.table,
    ids: [args.id],
  });
  return {
    main,
    languages: languageCounters(
      byDocument.get(args.id),
      args.languages.locales
    ),
  };
}

/**
 * A Drizzle database or transaction handle, as `getDrizzle()` answers it:
 * the part of its query builder a counter read uses, the same on every
 * dialect.
 */
export interface SelectsRows {
  select(fields: Record<string, unknown>): {
    from(table: never): {
      where(condition: unknown): PromiseLike<Record<string, unknown>[]>;
    };
  };
}

/**
 * Every translation row's counter for `ids`, in one statement: by document,
 * then by language.
 *
 * Selected through `languageRevisionTable`: a translation table's runtime
 * model does not declare the counter, since the same model serves
 * field-group translation tables, which are no documents and never carry it.
 */
async function readLanguageRevisions(
  db: SelectsRows,
  args: { dialect: SupportedDialect; table: string; ids: readonly string[] }
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (args.ids.length === 0) return out;
  const table = languageRevisionTable(args.dialect, args.table);
  const rows = await db
    .select({
      _parent: table._parent,
      _locale: table._locale,
      [DOCUMENT_REVISION_COLUMN]: table[DOCUMENT_REVISION_COLUMN],
    })
    .from(table as never)
    .where(inArray(table._parent as never, [...args.ids]));
  for (const row of rows) {
    const parent = String(row._parent);
    const languages = out.get(parent) ?? new Map<string, number>();
    languages.set(
      String(row._locale),
      revisionOf(row[DOCUMENT_REVISION_COLUMN])
    );
    out.set(parent, languages);
  }
  return out;
}

/** The counters of `locales`, 0 for a language with no translation row. */
function languageCounters(
  rows: ReadonlyMap<string, number> | undefined,
  locales: readonly string[]
): Record<string, number> {
  return Object.fromEntries(
    locales.map(locale => [locale, rows?.get(locale) ?? 0])
  );
}

/**
 * The languages a version names, for a document read or written in `locale`:
 * none for a document without translations, the one language a single-language
 * read or write resolves to, or every configured language for a wildcard.
 *
 * One answer for every read and write, so the version a save returns and the
 * version the next read returns are spelled from the same languages.
 */
export function versionLanguagesFor(args: {
  localized: boolean;
  localization: SanitizedLocalizationConfig | undefined;
  locale: string | undefined;
}): string[] | undefined {
  if (!args.localized || !args.localization) return undefined;
  if (args.locale !== undefined && isLocaleSelector(args.locale)) {
    return args.localization.locales.map(locale => locale.code);
  }
  return [resolveRequestedLocale(args.localization, args.locale)];
}

/**
 * The version a document holds on `tx`, spelled for `locale`, or undefined
 * when the document is gone.
 *
 * The one way a version is read for a write's response, spelled from the
 * same languages as a read's (`attachDocumentVersions`).
 */
export async function documentVersionOn(
  tx: Pick<TransactionContext, "select" | "getDrizzle">,
  args: {
    dialect: SupportedDialect;
    table: string;
    id: string;
    /**
     * The document's translation table when it has one to read, else null:
     * an entity that keeps no translations, or a translated one whose table
     * is not there yet, whose translated values still live on its own row.
     */
    languagesTable: string | null;
    localization: SanitizedLocalizationConfig | undefined;
    locale: string | undefined;
  }
): Promise<string | undefined> {
  const locales = versionLanguagesFor({
    localized: args.languagesTable !== null,
    localization: args.localization,
    locale: args.locale,
  });
  const revisions = await readDocumentRevisions(tx, {
    dialect: args.dialect,
    table: args.table,
    id: args.id,
    ...(locales && args.languagesTable !== null
      ? { languages: { table: args.languagesTable, locales } }
      : {}),
  });
  if (!revisions) return undefined;
  return encodeDocumentVersion(revisions.main, revisions.languages);
}

/** Keys every update carries whether or not it changes the row's content. */
const BOOKKEEPING_KEYS: ReadonlySet<string> = new Set([
  "updatedAt",
  "updated_at",
  "firstPublishedAt",
  "first_published_at",
]);

/**
 * Whether a save changes what a document's own counter covers: a value on
 * its main row, a component, or a relation. A save of translated fields alone
 * changes only that language's row, whose counter its upsert moves.
 */
function savesMainRow(args: {
  /** The values written to the main row, translated fields already split out. */
  updatePayload: Record<string, unknown>;
  componentFieldData: Record<string, unknown>;
  manyToManyData: Record<string, unknown>;
}): boolean {
  const writes = (values: Record<string, unknown>) =>
    Object.entries(values).some(
      ([key, value]) => value !== undefined && !BOOKKEEPING_KEYS.has(key)
    );
  return (
    writes(args.updatePayload) ||
    writes(args.componentFieldData) ||
    writes(args.manyToManyData)
  );
}

/**
 * Each read row's stored counter, by id, taken before the response is
 * sanitised: the counter column itself never leaves the server, and the
 * redaction that removes it runs before the hooks do.
 */
export function storedRevisionsOf(
  rows: readonly Record<string, unknown>[]
): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const row of rows) {
    const id = documentIdOf(row);
    if (id !== undefined && DOCUMENT_REVISION_COLUMN in row) {
      out.set(id, row[DOCUMENT_REVISION_COLUMN]);
    }
  }
  return out;
}

/** A row's id as a string, or undefined for a row without a usable one. */
function documentIdOf(row: Record<string, unknown>): string | undefined {
  const id = row.id;
  if (typeof id === "string") return id;
  return typeof id === "number" ? String(id) : undefined;
}

/**
 * Publish each row's version under `_rev`, in place.
 *
 * Never reads a counter itself. The translation counters are the read's own:
 * taken with the content in one statement (`languageRevisionsOf`), or before
 * it (`languageCountersBeforeContent`). Read here, after the content, a
 * counter could be newer than what the read shows, and a client saving from
 * it would overwrite a translation it never saw.
 *
 * A row whose stored counter was not read gets no version rather than a
 * guessed one.
 */
export function attachDocumentVersions(
  rows: Record<string, unknown>[],
  args: {
    stored: ReadonlyMap<string, unknown>;
    localization: SanitizedLocalizationConfig | undefined;
    locale: string | undefined;
    /**
     * The translation counters the read took, and the languages it took them
     * in; absent for documents that keep no translations, or whose
     * translation table is not there yet. The versions name languages exactly
     * when these are given.
     */
    known?: {
      revisions: ReadonlyMap<string, ReadonlyMap<string, number>>;
      locales: readonly string[];
    };
  }
): void {
  const locales = versionLanguagesFor({
    localized: args.known !== undefined,
    localization: args.localization,
    locale: args.locale,
  });
  // A read whose counters do not cover the languages its versions name took
  // them for the wrong languages; answering with zeros there would publish a
  // version no save produced.
  if (
    locales !== undefined &&
    !locales.every(locale => args.known?.locales.includes(locale))
  ) {
    throw NextlyError.internal({
      logContext: { reason: "document-version-languages-not-read" },
    });
  }
  for (const row of rows) {
    const id = documentIdOf(row);
    if (id === undefined || !args.stored.has(id)) {
      // No stored document to take a version from, such as a row whose id a
      // hook rewrote: it carries none, rather than one the hook set.
      delete row[DOCUMENT_VERSION_KEY];
      continue;
    }
    row[DOCUMENT_VERSION_KEY] = encodeDocumentVersion(
      revisionOf(args.stored.get(id)),
      locales
        ? languageCounters(args.known?.revisions.get(id), locales)
        : undefined
    );
  }
}

/**
 * Translation counters from translation rows a read already holds, by
 * document, then by language; undefined when any of those rows was read
 * without its counter, which then has to be read by itself.
 */
export function languageRevisionsOf(
  rows: readonly Record<string, unknown>[]
): Map<string, Map<string, number>> | undefined {
  const out = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!(DOCUMENT_REVISION_COLUMN in row)) return undefined;
    const parent = row._parent;
    const locale = row._locale;
    if (typeof parent !== "string" || typeof locale !== "string") continue;
    const languages = out.get(parent) ?? new Map<string, number>();
    languages.set(locale, revisionOf(row[DOCUMENT_REVISION_COLUMN]));
    out.set(parent, languages);
  }
  return out;
}

/** Publish `version` on a response document, when there is one to publish. */
export function setDocumentVersion(
  doc: Record<string, unknown>,
  version: string | undefined
): void {
  if (version !== undefined) doc[DOCUMENT_VERSION_KEY] = version;
}

/**
 * The assignments a save adds to its main-row UPDATE: the counter and the
 * changer when it changes what the main row's version covers
 * (`savesMainRow`), nothing when it changed translated fields alone.
 */
export function mainRowBump(
  write: Parameters<typeof savesMainRow>[0],
  actor: RequestActor,
  /** The moment the save writes to `updated_at`. */
  at: Date
): Record<string, unknown> {
  return savesMainRow(write) ? revisionBumpColumns(actor, at) : {};
}

/**
 * The translation table a version reads, from what a write or read already
 * knows of it: its table when it is there to read, else null.
 */
export function translationTableOf(
  companion: { companionTableName: string } | null | undefined,
  ready = true
): string | null {
  return companion && ready ? companion.companionTableName : null;
}

/** `data` with `version` published on it, when there is one to publish. */
export function withDocumentVersion<T extends Record<string, unknown>>(
  data: T,
  version: string | undefined
): T {
  return version === undefined
    ? data
    : { ...data, [DOCUMENT_VERSION_KEY]: version };
}

/**
 * Every configured language's counter for `ids`, read now, for a read that
 * takes the translated content in a later statement.
 *
 * Read BEFORE the content so a save landing between the two can only make a
 * version look older than what was read, never newer: a newer counter beside
 * older content would let a client save over a translation it never saw.
 */
export async function languageCountersBeforeContent(
  db: SelectsRows,
  args: {
    dialect: SupportedDialect;
    languagesTable: string | null;
    localization: SanitizedLocalizationConfig | undefined;
    ids: readonly string[];
  }
): Promise<
  | {
      revisions: Map<string, Map<string, number>>;
      locales: readonly string[];
    }
  | undefined
> {
  if (args.languagesTable === null || !args.localization) return undefined;
  if (args.ids.length === 0) return undefined;
  return {
    revisions: await readLanguageRevisions(db, {
      dialect: args.dialect,
      table: args.languagesTable,
      ids: args.ids,
    }),
    locales: args.localization.locales.map(locale => locale.code),
  };
}

/**
 * Whether a read taking its translations in `chain` holds the counter of
 * every language its version names, so the version can come out of that
 * same statement. A read of every language does not: its chain is the
 * fallback chain of one language.
 */
export function chainCoversVersion(
  chain: readonly string[],
  args: {
    localization: SanitizedLocalizationConfig | undefined;
    locale: string | undefined;
  }
): boolean {
  const locales = versionLanguagesFor({ localized: true, ...args });
  return locales === undefined || locales.every(code => chain.includes(code));
}

/**
 * The moment an UPDATE writes to `updated_at`, for the `_changed_at` it sets
 * beside it: the same value, so the two compare equal. Now, for a payload
 * that names none.
 */
export function updateTimeOf(value: unknown): Date {
  return value instanceof Date ? value : new Date();
}
