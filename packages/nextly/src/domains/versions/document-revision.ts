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
import { sql } from "drizzle-orm";

import type { RequestActor } from "../../auth/request-actor";
import { NextlyError } from "../../errors/nextly-error";
import {
  DOCUMENT_VERSION_KEY,
  MIGRATE_STEP_COLUMN_NAMES,
} from "../../lib/system-columns";
import { contentEventActor } from "../content-events/actor";
import type { SanitizedLocalizationConfig } from "../i18n/config/types";
import { isLocaleSelector } from "../i18n/locale-selector";
import { resolveRequestedLocale } from "../i18n/resolve-locale";

export { DOCUMENT_VERSION_KEY };

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
 * Ids only — a name is looked up when one is shown, so a person erased later
 * leaves nothing in a content row to scrub.
 */
export function changerColumns(
  actor: RequestActor
): Record<string, string | null> {
  const event = contentEventActor(actor, null);
  return {
    _changed_by_kind: event.kind,
    _changed_by_id: event.kind === "system" ? null : event.id,
    _changed_by_principal_kind:
      event.kind === "principal" ? event.principalKind : null,
  };
}

/**
 * What one save adds to the UPDATE of a row it changes: the counter
 * incremented by the database, and the changer.
 *
 * The increment is an expression, never a value computed from a read, so two
 * saves can never both write the same next version: the row lock the UPDATE
 * takes orders them, and each adds one to what the other committed.
 */
export function revisionBumpColumns(
  actor: RequestActor
): Record<string, unknown> {
  return {
    [DOCUMENT_REVISION_COLUMN]: sql`${sql.identifier(DOCUMENT_REVISION_COLUMN)} + 1`,
    ...changerColumns(actor),
  };
}

/**
 * Increment a row's counter on its own, for a save that writes nothing else
 * to that row: a held working draft, a status moved only on translation rows,
 * a change to components or relations alone. `updated_at` is left as it is,
 * since the row's own content did not change.
 */
export async function bumpDocumentRevision(
  tx: Pick<TransactionContext, "update">,
  table: string,
  where: Record<string, string>,
  actor: RequestActor
): Promise<void> {
  await tx.update(table, revisionBumpColumns(actor), {
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
export async function readDocumentRevisions(
  tx: Pick<TransactionContext, "select" | "execute">,
  args: {
    dialect: SupportedDialect;
    table: string;
    id: string;
    /** The translation table and the languages to report, when any. */
    languages?: { table: string; locales: readonly string[] };
  }
): Promise<{ main: number; languages?: Record<string, number> }> {
  const [row] = await tx.select<Record<string, unknown>>(args.table, {
    columns: [DOCUMENT_REVISION_COLUMN],
    where: { and: [{ column: "id", op: "=", value: args.id }] },
    limit: 1,
  });
  if (!row) {
    throw NextlyError.internal({
      logContext: {
        reason: "document-revision-row-missing",
        table: args.table,
      },
    });
  }
  const main = revisionOf(row[DOCUMENT_REVISION_COLUMN]);
  if (!args.languages || args.languages.locales.length === 0) return { main };
  const byDocument = await readLanguageRevisions(
    (statement, params) => tx.execute(statement, params),
    { dialect: args.dialect, table: args.languages.table, ids: [args.id] }
  );
  return {
    main,
    languages: languageCounters(
      byDocument.get(args.id),
      args.languages.locales
    ),
  };
}

/** Runs one statement with its parameters and answers its rows. */
export type RunStatement = (
  statement: string,
  params: (string | number)[]
) => Promise<Record<string, unknown>[]>;

/**
 * Every translation row's counter for `ids`, in one statement: by document,
 * then by language.
 *
 * Named in the statement: a translation table's runtime model does not
 * declare the counter, since the same model serves field-group translation
 * tables, which are no documents and never carry it.
 */
export async function readLanguageRevisions(
  run: RunStatement,
  args: { dialect: SupportedDialect; table: string; ids: readonly string[] }
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (args.ids.length === 0) return out;
  const q = (name: string) =>
    args.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const placeholders = args.ids
    .map((_, i) => (args.dialect === "postgresql" ? `$${i + 1}` : "?"))
    .join(", ");
  const rows = await run(
    `SELECT ${q("_parent")}, ${q("_locale")}, ${q(DOCUMENT_REVISION_COLUMN)} FROM ${q(args.table)} WHERE ${q("_parent")} IN (${placeholders})`,
    [...args.ids]
  );
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
export function languageCounters(
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
 * The version a document holds on `tx`, spelled for `locale`.
 *
 * The one way a version is read for a response, so a write's answer and a
 * read's answer cannot be built two ways.
 */
export async function documentVersionOn(
  tx: Pick<TransactionContext, "select" | "execute">,
  args: {
    dialect: SupportedDialect;
    table: string;
    id: string;
    localized: boolean;
    localization: SanitizedLocalizationConfig | undefined;
    locale: string | undefined;
  }
): Promise<string> {
  const locales = versionLanguagesFor(args);
  const revisions = await readDocumentRevisions(tx, {
    dialect: args.dialect,
    table: args.table,
    id: args.id,
    ...(locales
      ? { languages: { table: `${args.table}_locales`, locales } }
      : {}),
  });
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
export function savesMainRow(args: {
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
 * Publish each row's version under `_rev`, in place, reading every
 * translation counter the rows need in one statement.
 *
 * A row whose stored counter was not read gets no version rather than a
 * guessed one.
 */
export async function attachDocumentVersions(
  rows: Record<string, unknown>[],
  args: {
    stored: ReadonlyMap<string, unknown>;
    run: RunStatement;
    dialect: SupportedDialect;
    table: string;
    /** The languages each version names (`versionLanguagesFor`). */
    locales: readonly string[] | undefined;
  }
): Promise<void> {
  const ids = rows
    .map(documentIdOf)
    .filter((id): id is string => id !== undefined && args.stored.has(id));
  if (ids.length === 0) return;
  const languages = args.locales
    ? await readLanguageRevisions(args.run, {
        dialect: args.dialect,
        table: `${args.table}_locales`,
        ids,
      })
    : undefined;
  for (const row of rows) {
    const id = documentIdOf(row);
    if (id === undefined || !args.stored.has(id)) continue;
    row[DOCUMENT_VERSION_KEY] = encodeDocumentVersion(
      revisionOf(args.stored.get(id)),
      args.locales
        ? languageCounters(languages?.get(id), args.locales)
        : undefined
    );
  }
}
