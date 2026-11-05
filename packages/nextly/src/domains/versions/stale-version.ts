/**
 * An update judged against the version its caller read.
 *
 * A client hands back the `_rev` it read with the values it changed. The
 * update is applied only when that is still the document's version where the
 * save writes: its own row, and the translation row of the language it saves.
 * Otherwise someone else's save came in between, and applying this one would
 * silently overwrite it, so it is refused with `STALE_VERSION`.
 *
 * Every write path asks the same pieces, so they cannot answer one update
 * differently: the decision at the boundary (`versionCheckFor`), the read of
 * the counters and who moved them (`readDocumentRevision`), the comparison
 * (`staleParts`), the one source of "when" (`changedAtOf`), the picker of who
 * changed it last (`lastChangerOf`), and what a caller is told of a change
 * (`staleVersionData`): by a refused save (`staleVersionErrorFor`) and by a
 * recovery point's read (`changesSinceVersion`) alike.
 *
 * @module domains/versions/stale-version
 * @experimental
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import type { RequestActor } from "../../auth/request-actor";
import { NextlyError } from "../../errors/nextly-error";
import type { StaleVersionPublicData } from "../../errors/public-data";
import { DOCUMENT_VERSION_KEY } from "../../lib/system-columns";
import { claimCompanionRevision } from "../i18n/runtime/companion-io";
import { languageRevisionTable } from "../schema/services/runtime-schema-generator";
import type { UserContext } from "../singles/types";

import { peopleById } from "./author-hydration";
import {
  CHANGED_AT_COLUMN,
  DOCUMENT_OVERWRITE_KEY,
  DOCUMENT_REVISION_COLUMN,
  encodeDocumentVersion,
  revisionOf,
  type SelectsRows,
} from "./document-revision";

/** A language's counter in a version: 0 where it names none. */
function languageCounterOf(version: DecodedVersion, code: string): number {
  return Object.hasOwn(version.languages, code) ? version.languages[code] : 0;
}

/** A version as its parts: the main counter, and each language's it names. */
export interface DecodedVersion {
  main: number;
  languages: Readonly<Record<string, number>>;
}

// `7`, `7.es:3`, `7.en:2,es:3`: what `encodeDocumentVersion` spells. A
// language code holds letters, digits, `-` and `_` (`pt-BR`, `zh_Hant`), never
// `.`, `:` or `,`.
const VERSION_PATTERN =
  /^(\d+)(?:\.([A-Za-z0-9_-]+:\d+(?:,[A-Za-z0-9_-]+:\d+)*))?$/;

/** The refusal of a version that can't be judged: a client's mistake, not someone's change. */
function unjudgeable(message: string): NextlyError {
  return NextlyError.validation({
    errors: [{ path: DOCUMENT_VERSION_KEY, code: "INVALID_VALUE", message }],
  });
}

/**
 * The parts of a `_rev` as a read published it.
 *
 * @throws NextlyError.validation when it is not one, so a typo is never
 *   judged as someone else's change.
 */
function decodeDocumentVersion(raw: unknown): DecodedVersion {
  const match = typeof raw === "string" ? VERSION_PATTERN.exec(raw) : null;
  if (!match) {
    throw unjudgeable(
      `${DOCUMENT_VERSION_KEY} must be the version a read returned, such as "7" or "7.es:3".`
    );
  }
  const main = Number(match[1]);
  if (!Number.isSafeInteger(main) || main < 1) {
    throw unjudgeable(
      `${DOCUMENT_VERSION_KEY} names a version no document has.`
    );
  }
  // Without a prototype, so a language code such as `constructor` is only
  // ever an own key.
  const languages: Record<string, number> = Object.create(null) as Record<
    string,
    number
  >;
  for (const part of match[2]?.split(",") ?? []) {
    const [code, counter] = part.split(":");
    const n = Number(counter);
    if (Object.hasOwn(languages, code) || !Number.isSafeInteger(n)) {
      throw unjudgeable(
        `${DOCUMENT_VERSION_KEY} names a version no document has.`
      );
    }
    languages[code] = n;
  }
  return { main, languages };
}

/**
 * The version `body` names, decoded; undefined when it names none. Only the
 * decode: whether a write must name one is `versionCheckFor`'s to decide.
 *
 * @throws NextlyError.validation for a `_rev` that is not a version.
 */
export function givenVersionOf(
  body: Readonly<Record<string, unknown>>
): DecodedVersion | undefined {
  const raw = body[DOCUMENT_VERSION_KEY];
  return raw === undefined ? undefined : decodeDocumentVersion(raw);
}

/**
 * What an update is judged against: the version it gave, or nothing.
 *
 * One decision, taken once at each write path's boundary, before the body's
 * version is dropped: a write with no `_rev`, or one the server exempts, is
 * applied as it always was. `overwrite` is a write that names
 * `_overwrite: true`: it saves over whatever came in between, and the
 * version it gave, if any, says what it replaced.
 */
export type VersionCheck =
  | { kind: "judge"; given: DecodedVersion; raw: string }
  | { kind: "overwrite"; given?: DecodedVersion }
  | { kind: "unjudged" };

/** The version a check carries, judged or overwritten. */
export function givenOf(check: VersionCheck): DecodedVersion | undefined {
  return check.kind === "unjudged" ? undefined : check.given;
}

/**
 * Whether the update says to overwrite: `true` or `false` as given, false
 * when absent.
 *
 * @throws NextlyError.validation for any other value, so a client that meant
 *   something else by it is told rather than judged as if it said nothing.
 */
function overwriteOf(body: Readonly<Record<string, unknown>>): boolean {
  const value = body[DOCUMENT_OVERWRITE_KEY];
  if (value === undefined || value === false) return false;
  if (value === true) return true;
  throw NextlyError.validation({
    errors: [
      {
        path: DOCUMENT_OVERWRITE_KEY,
        code: "INVALID_VALUE",
        message: `${DOCUMENT_OVERWRITE_KEY} must be true or false.`,
      },
    ],
  });
}

/**
 * Decide how `body` is judged.
 *
 * `exempt` comes from trusted server code alone (`releaseRunExemptFor`),
 * never from anything a caller sends: a key in the body, an option or a
 * query that claimed it would let any client skip the check.
 *
 * @throws NextlyError.validation for a `_rev` that is not a version, or an
 *   `_overwrite` that is not true or false.
 */
export function versionCheckFor(
  body: Readonly<Record<string, unknown>>,
  options: { exempt: boolean }
): VersionCheck {
  // Both read even when exempt, so a malformed value is refused the same way
  // on every path.
  const overwrite = overwriteOf(body);
  const given = givenVersionOf(body);
  if (options.exempt) return { kind: "unjudged" };
  if (overwrite)
    return given ? { kind: "overwrite", given } : { kind: "overwrite" };
  return given
    ? { kind: "judge", given, raw: body[DOCUMENT_VERSION_KEY] as string }
    : { kind: "unjudged" };
}

/**
 * Refuse a version given in the one set of values an update of several
 * documents writes to all of them (by ids or by query): it names one
 * document's version, and judged against the others it would refuse each of
 * them or, worse, be taken as current for one it was never read from.
 *
 * @throws NextlyError.validation when `data` carries `_rev`.
 */
function refuseVersionInSharedData(
  data: Readonly<Record<string, unknown>>
): void {
  if (data[DOCUMENT_VERSION_KEY] === undefined) return;
  throw unjudgeable(
    `${DOCUMENT_VERSION_KEY} names one document's version, so an update of several documents with the same values can't carry it. Update each document with its own version.`
  );
}

/**
 * Where an update by ids that writes the same values to every id gives each
 * document's own version: `{ "<id>": "<_rev>" }`, beside `ids` and `data`.
 *
 * @experimental
 */
const DOCUMENT_REVS_KEY = "revs";

/**
 * How an update that writes the same values to many documents is judged:
 * each id on its own version (`per-document`), over whatever each holds
 * (`overwrite`), or neither (`required`), which an update of many documents
 * cannot be judged by, since it carries no one document's version.
 *
 * @experimental
 */
export type SameValuesRequirement =
  | { kind: "per-document"; revs: Readonly<Record<string, string>> }
  | { kind: "overwrite" }
  | { kind: "required"; byIds: boolean };

const RevsByIdSchema = z.record(z.string(), z.string());

/**
 * Decide how an update that writes `data` to many documents is judged, before
 * any of them is read: by its ids (`target.ids`), with a version for each in
 * `target.revs`, or by a query (`target.ids` undefined), which names no ids to
 * give versions for. One answer for every door, so REST, the Direct API and
 * the services cannot judge one request two ways.
 *
 * @throws NextlyError.validation for a version in the shared data, an
 *   `_overwrite` that is not true or false, versions on an update by query,
 *   versions that are not text keyed by id, a version for an id the update
 *   does not name, one that is not a version, or versions given beside
 *   `_overwrite: true`.
 * @throws NextlyError.versionRequired when versions are given for some ids
 *   only: the rest would be written over whatever they hold, unjudged.
 *
 * @experimental
 */
export function sameValuesVersionRequirement(
  data: Readonly<Record<string, unknown>>,
  target: { ids: readonly string[] | undefined; revs?: unknown }
): SameValuesRequirement {
  refuseVersionInSharedData(data);
  const overwrite = overwriteOf(data);
  if (target.revs === undefined) {
    return overwrite
      ? { kind: "overwrite" }
      : { kind: "required", byIds: target.ids !== undefined };
  }
  if (target.ids === undefined) {
    throw unrevisable(
      `${DOCUMENT_REVS_KEY} gives versions by id, and an update by query names no ids. Update by ids to give each document's version.`
    );
  }
  const parsed = RevsByIdSchema.safeParse(target.revs);
  if (!parsed.success) {
    throw unrevisable(
      `${DOCUMENT_REVS_KEY} must map each id to the version a read of it returned.`
    );
  }
  if (overwrite) {
    throw unrevisable(
      `${DOCUMENT_REVS_KEY} and ${DOCUMENT_OVERWRITE_KEY} say two different things: give each document's version, or overwrite them all.`
    );
  }
  const named = new Set(target.ids);
  for (const [id, rev] of Object.entries(parsed.data)) {
    if (!named.has(id)) {
      throw unrevisable(
        `${DOCUMENT_REVS_KEY} gives a version for a document this update does not name.`
      );
    }
    // Refused here, before any document is read, rather than as each one's
    // own refusal once the others are written.
    decodeDocumentVersion(rev);
  }
  // Own keys only: an id named like a prototype member is not a version.
  if (target.ids.some(id => !Object.hasOwn(parsed.data, id))) {
    throw versionRequiredFor("ids");
  }
  return { kind: "per-document", revs: parsed.data };
}

/** The refusal of `revs` that cannot be judged: a client's mistake. */
function unrevisable(message: string): NextlyError {
  return NextlyError.validation({
    errors: [{ path: DOCUMENT_REVS_KEY, code: "INVALID_VALUE", message }],
  });
}

/**
 * The refusal of an update of many documents with the same values that gives
 * neither a version for each nor the overwrite choice, naming the keys that
 * say either.
 *
 * @experimental
 */
export function versionRequiredFor(bulk: "ids" | "query"): NextlyError {
  return NextlyError.versionRequired({
    bulk,
    keys: {
      version: DOCUMENT_VERSION_KEY,
      overwrite: DOCUMENT_OVERWRITE_KEY,
      revs: DOCUMENT_REVS_KEY,
    },
  });
}

/** The document a release run's mark is for. */
export interface ReleaseRunTarget {
  scopeKind: "collection" | "single";
  scopeSlug: string;
  /** The entry, for a collection; a Single is matched on its slug. */
  entryId?: string;
}

const releaseRun = new AsyncLocalStorage<ReleaseRunTarget>();

/**
 * Run `operation` as a release run's write to `target`, which is not judged:
 * a scheduled run publishes what its release was given, whatever was saved
 * since. Pinned by the release runner only. A write to any other document
 * made meanwhile, by a hook say, is judged as usual.
 *
 * @internal
 */
export function runAsReleaseRun<T>(
  target: ReleaseRunTarget,
  operation: () => T
): T {
  return releaseRun.run(target, operation);
}

/** Whether a write to `target` is a release run's own, and so not judged. */
export function releaseRunExemptFor(target: ReleaseRunTarget): boolean {
  const pinned = releaseRun.getStore();
  if (pinned === undefined) return false;
  if (pinned.scopeKind !== target.scopeKind) return false;
  if (pinned.scopeSlug !== target.scopeSlug) return false;
  return target.scopeKind === "single" || pinned.entryId === target.entryId;
}

/** Who made a row's last counted change, as the row records it: ids only. */
export interface RowChanger {
  kind: string | null;
  id: string | null;
  principalKind: string | null;
}

/** One row's state: its counter, who moved it last, and when it last changed. */
export interface PartState {
  /** `main`, or the language of a translation row. */
  part: string;
  /** 0 for a language with no row. */
  counter: number;
  changer: RowChanger;
  at: Date | null;
}

/** A document's state where a save is judged: its own row and each language asked. */
export interface DocumentRevisionState {
  main: PartState;
  languages: Record<string, PartState>;
}

const CHANGER_COLUMNS = [
  "_changed_by_kind",
  "_changed_by_id",
  "_changed_by_principal_kind",
] as const;

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * When a row's counter last moved, as every judgement and every picker
 * orders it: the one source of "when", so no two callers can disagree about
 * which change came last. Its `_changed_at`, set in the same statement as
 * the counter, so a save that moves the counter and not `updated_at` (a held
 * draft, a discard, publishing every language) is still dated. Null for a row
 * not saved since the column was added, which a refusal then gives no time.
 * Read through a model that declares the column, so it arrives as a `Date`.
 */
function changedAtOf(row: Record<string, unknown>): Date | null {
  const value = row[CHANGED_AT_COLUMN];
  if (value === null || value === undefined) return null;
  const at = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(at.getTime()) ? null : at;
}

function stateOf(part: string, row: Record<string, unknown>): PartState {
  return {
    part,
    counter: revisionOf(row[DOCUMENT_REVISION_COLUMN]),
    changer: {
      kind: textOrNull(row._changed_by_kind),
      id: textOrNull(row._changed_by_id),
      principalKind: textOrNull(row._changed_by_principal_kind),
    },
    at: changedAtOf(row),
  };
}

/** A language with no translation row: counter 0, changed by nobody. */
function absentPart(part: string): PartState {
  return {
    part,
    counter: 0,
    changer: { kind: null, id: null, principalKind: null },
    at: null,
  };
}

/**
 * A document's counters, last changers and change times: its own row, and
 * each of `languages`' translation rows.
 *
 * On `db`, a transaction or the pool. `forUpdate` reads the latest committed
 * row under a row lock rather than the transaction's snapshot, which a write
 * judging the main row needs on MySQL: there a plain read after the lock
 * returns what the transaction saw when it began. Translation rows are read
 * without a lock: a write judges its own language only after writing that
 * row (see `staleParts`), since locking a translation row that is not there
 * takes a range lock that deadlocks two documents' first translations on
 * MySQL.
 *
 * Undefined when the document is gone.
 */
export async function readDocumentRevision(
  db: RevisionReader,
  args: {
    dialect: SupportedDialect;
    table: string;
    id: string;
    languages?: { table: string; locales: readonly string[] };
    forUpdate?: boolean;
  }
): Promise<DocumentRevisionState | undefined> {
  const [row] = await db.select<Record<string, unknown>>(args.table, {
    columns: [DOCUMENT_REVISION_COLUMN, ...CHANGER_COLUMNS, CHANGED_AT_COLUMN],
    where: { and: [{ column: "id", op: "=", value: args.id }] },
    limit: 1,
    ...(args.forUpdate ? { forUpdate: true } : {}),
  });
  if (!row) return undefined;
  const state: DocumentRevisionState = {
    main: stateOf("main", row),
    languages: {},
  };
  const locales = args.languages?.locales ?? [];
  if (!args.languages || locales.length === 0) return state;
  // Through the translation table's revision model: its runtime model does
  // not declare the per-document columns, since the same model serves
  // field-group translation tables, which are no documents.
  const table = languageRevisionTable(args.dialect, args.languages.table);
  const rows = await db
    .getDrizzle<SelectsRows>()
    .select({
      _locale: table._locale,
      [DOCUMENT_REVISION_COLUMN]: table[DOCUMENT_REVISION_COLUMN],
      ...Object.fromEntries(CHANGER_COLUMNS.map(name => [name, table[name]])),
      [CHANGED_AT_COLUMN]: table[CHANGED_AT_COLUMN],
    })
    .from(table as never)
    .where(
      and(
        eq(table._parent as never, args.id),
        inArray(table._locale as never, [...locales])
      )
    );
  const byLocale = new Map(rows.map(r => [String(r._locale), r]));
  for (const locale of locales) {
    const found = byLocale.get(locale);
    state.languages[locale] = found
      ? stateOf(locale, found)
      : absentPart(locale);
  }
  return state;
}

/** What `readDocumentRevision` reads through: a transaction, or the pool. */
export type RevisionReader = Pick<TransactionContext, "select" | "getDrizzle">;

/**
 * The language a save judges, or undefined where it judges none: a document
 * with no translation table, or a save that writes no translated value.
 *
 * @throws NextlyError.validation when the save writes a language its version
 *   does not name, since that version came from a read of another language.
 */
export function judgedLanguage(
  given: DecodedVersion | undefined,
  writeLocale: string | undefined
): string | undefined {
  if (given === undefined || writeLocale === undefined) return undefined;
  if (!Object.hasOwn(given.languages, writeLocale)) {
    throw unjudgeable(
      `${DOCUMENT_VERSION_KEY} names no version of ${writeLocale}, the language this update saves. Send the version a read of ${writeLocale} returned.`
    );
  }
  return writeLocale;
}

/**
 * Refuse a version that does not name every one of `locales`, for a write
 * over every language at once (`locale: "*"`): only a read of every language
 * gives one that does, and judging a missing language as 0 would refuse the
 * write over a language its caller never read, rather than tell it so.
 *
 * @throws NextlyError.validation naming the languages it lacks.
 */
export function assertVersionNamesEvery(
  given: DecodedVersion | undefined,
  locales: readonly string[]
): void {
  if (given === undefined) return;
  const missing = locales.filter(code => !Object.hasOwn(given.languages, code));
  if (missing.length === 0) return;
  throw unjudgeable(
    `${DOCUMENT_VERSION_KEY} names no version of ${missing.join(", ")}. An update of every language at once needs the version a read of every language returned.`
  );
}

/**
 * The parts of a document that moved since the version given: none when the
 * save may go ahead.
 *
 * `main` compares the main row as read under the lock, before the write.
 * `languages` compares each language row as read before any write, for a
 * write over several languages at once, such as publishing every language:
 * a language the version does not name counts as 0.
 */
export function staleParts(
  given: DecodedVersion,
  args: {
    main?: PartState;
    languages?: readonly PartState[];
  }
): string[] {
  const stale: string[] = [];
  if (args.main && args.main.counter !== given.main) stale.push("main");
  for (const language of args.languages ?? []) {
    if (language.counter !== languageCounterOf(given, language.part)) {
      stale.push(language.part);
    }
  }
  return stale;
}

/** Who changed a document last, as the picker answers: ids only, never a name. */
export interface LastChanger {
  kind: string;
  id: string | null;
  principalKind: string | null;
  at: Date | null;
  part: string;
}

/**
 * Who made the latest change among `parts`: of the parts whose counter moved
 * from `given` when one is given, else of all of them.
 *
 * Ordered by `changedAtOf`, the one source of "when"; equal times go to main
 * first, then by language code, so the answer never depends on read order; a
 * part with no time is the oldest. Null when nothing moved, or the winning
 * row records no changer (a row unwritten since the columns were added).
 *
 * Ids only. Whether the caller may be told, and the name shown for an id,
 * are the refusal's to decide, so a stored record can keep the ids and name
 * them when read.
 *
 * @experimental
 */
export function lastChangerOf(
  parts: readonly PartState[],
  given?: DecodedVersion
): LastChanger | null {
  const moved = given
    ? parts.filter(part =>
        part.part === "main"
          ? part.counter !== given.main
          : part.counter !== languageCounterOf(given, part.part)
      )
    : [...parts];
  const rank = (part: PartState) => (part.part === "main" ? "" : part.part);
  const latest = moved.sort((a, b) => {
    const at = (b.at?.getTime() ?? -Infinity) - (a.at?.getTime() ?? -Infinity);
    if (at !== 0) return at;
    return rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0;
  })[0];
  if (!latest || latest.changer.kind === null) return null;
  return {
    kind: latest.changer.kind,
    id: latest.changer.id,
    principalKind: latest.changer.principalKind,
    at: latest.at,
    part: latest.part,
  };
}

const CHANGER_KINDS: ReadonlySet<string> = new Set([
  "person",
  "apiKey",
  "release",
  "agent",
  "principal",
  "system",
]);

/**
 * A last changer as a refusal shows it: a person by the name their account
 * gives now, never their email, and no name once the account is gone; a
 * plugin-defined person by their kind alone; anything else by its kind.
 * Undefined for a kind this version of Nextly does not know.
 */
async function shownChanger(
  changer: LastChanger,
  namePeople: boolean
): Promise<StaleVersionPublicData["changedBy"]> {
  if (!CHANGER_KINDS.has(changer.kind)) return undefined;
  const kind = changer.kind as NonNullable<
    StaleVersionPublicData["changedBy"]
  >["kind"];
  if (kind === "principal") {
    return {
      kind,
      name: null,
      ...(changer.principalKind
        ? { principalKind: changer.principalKind }
        : {}),
    };
  }
  const person =
    namePeople && kind === "person" && changer.id
      ? (await peopleById([changer.id])).get(changer.id)
      : undefined;
  return { kind, name: person?.name || null };
}

/**
 * The refusal of an update made from an out-of-date version.
 *
 * The current version always. Who or what changed it last, and when, only
 * where `mayRead` says the caller may read the document, the same decision a
 * read of it gets. A person is named as their account names them now, never
 * by email, and nobody once the account is gone; a plugin-defined person by
 * their kind alone. No value of the document.
 *
 * @experimental
 */
interface StaleVersionDataArgs {
  given: DecodedVersion;
  /** The current version, as a read of the save's language spells it. */
  currentVersion: string;
  /** The parts the save writes, main first. */
  parts: readonly PartState[];
  mayRead: () => Promise<boolean>;
  /** Whether a person may be looked up by name (a pooled read). */
  namePeople: boolean;
  /**
   * The newest recorded version of the part the save writes, where the caller
   * may read that part's history; asked only once `mayRead` allows.
   */
  historyVersion?: () => Promise<StaleVersionPublicData["historyVersion"]>;
}

/**
 * What a document changed since `given`, as a caller is told it: the
 * current version always; who or what changed it last, and when, only where
 * `mayRead` says the caller may read the document, the same decision a read
 * of it gets. A person is named as their account names them now, never by
 * email, and nobody once the account is gone; a plugin-defined person by
 * their kind alone. No value of the document.
 */
async function staleVersionData(
  args: StaleVersionDataArgs
): Promise<StaleVersionPublicData> {
  const data: StaleVersionPublicData = { currentVersion: args.currentVersion };
  if (await args.mayRead()) {
    const changer = lastChangerOf(args.parts, args.given);
    const changedBy = changer
      ? await shownChanger(changer, args.namePeople)
      : undefined;
    if (changedBy) data.changedBy = changedBy;
    if (changer?.at) data.changedAt = changer.at.toISOString();
    const history = await args.historyVersion?.();
    if (history) data.historyVersion = history;
  }
  return data;
}

/**
 * Whether the caller of a refused update may be told who changed the document
 * and when: whether their own read of it returns it in each language the
 * refusal reports (`readsAsItsCaller`, the read rule and its filter, draft and
 * published visibility and read hooks included). A trusted server caller may. An anonymous visitor
 * never is, even one the Public role lets read the document: who changed it is
 * part of its history, which visitors are never shown.
 *
 * @experimental
 */
async function callerMayReadDocument(args: {
  scopeKind: "collection" | "single";
  slug: string;
  entryId: string;
  user: UserContext | undefined;
  trusted: boolean;
  authenticatedScope?: AuthenticatedScope;
  hookInputs?: { request?: Request; context?: Record<string, unknown> };
  /** The languages the refusal is about, each of which the caller must be able to read. */
  locales?: readonly string[];
}): Promise<boolean> {
  if (args.trusted) return true;
  if (!args.user) return false;
  // In each language the refusal reports, or the default one.
  const locales: readonly (string | undefined)[] =
    args.locales && args.locales.length > 0 ? args.locales : [undefined];
  for (const locale of locales) {
    if (!(await readsAsItsCaller({ ...args, user: args.user, locale }))) {
      return false;
    }
  }
  return true;
}

/**
 * Whether the caller's own read of the document, in `locale`, would return
 * it: the whole read decision, the collection's or Single's read rule and its
 * filter included. Not a route's: an update request carries no read verdict,
 * so a read asked as one a route already authorized would allow every
 * signed-in caller without asking the rule. Anything but a read that returns
 * this document counts as "may not read", so who changed it is never told on
 * a failure.
 */
async function readsAsItsCaller(args: {
  scopeKind: "collection" | "single";
  slug: string;
  entryId: string;
  user: UserContext;
  authenticatedScope?: AuthenticatedScope;
  hookInputs?: { request?: Request; context?: Record<string, unknown> };
  locale: string | undefined;
}): Promise<boolean> {
  // Loaded when a refusal is built, not with the write path: the reads go
  // through the services an ordinary save never needs.
  if (args.scopeKind === "single") {
    const { singleDocumentReadable } = await import(
      "../singles/services/single-document-access"
    );
    try {
      return await singleDocumentReadable(args.slug, {
        user: args.user,
        routeAuthorized: false,
        ...(args.authenticatedScope === undefined
          ? {}
          : { actor: args.authenticatedScope }),
        ...(args.locale === undefined ? {} : { locale: args.locale }),
        ...args.hookInputs,
      });
    } catch {
      return false;
    }
  }
  const { getService } = await import("../../di");
  const result = (await getService("collectionsHandler").getEntry({
    collectionName: args.slug,
    entryId: args.entryId,
    user: args.user,
    overrideAccess: false,
    routeAuthorized: false,
    authenticatedScope: args.authenticatedScope,
    // Drafts too: the refusal is about the document as it is stored.
    status: "all",
    ...args.hookInputs,
    ...(args.locale === undefined ? {} : { locale: args.locale }),
  } as never)) as { success: boolean; resolvedEntryId?: unknown };
  // The read must be of this document: a hook may rewrite the id a read
  // resolves, and another document's rules would not decide this one.
  return result.success && result.resolvedEntryId === args.entryId;
}

/**
 * Where a save found out of date is answered from: its table, and the
 * language that moved, or every language for a write over all of them.
 */
export interface StaleWrite {
  table: string;
  /**
   * The translation table and the languages the refusal's current version
   * names: the ones the save is judged on, so the version it answers can be
   * sent back with the same save.
   */
  languages?: { table: string; locales: readonly string[] };
}

/**
 * Set by a refusal inside a write's transaction, for the write path to answer
 * from once the transaction has rolled back: the adapter wraps what is thrown
 * out of a transaction, so the error itself no longer says what it was.
 */
export interface StaleWriteHolder {
  at?: StaleWrite;
}

/** The pool, as `readDocumentRevision` reads it outside a transaction. */
export function poolRevisionReader(adapter: RevisionReader): RevisionReader {
  return {
    select: (table, options) => adapter.select(table, options),
    getDrizzle: () => adapter.getDrizzle(),
  };
}

/**
 * Whether the version given is below the one the document already holds,
 * before any hook runs: a counter only goes up, so such a version is
 * certainly out of date. Any other is left for the row lock to decide.
 */
export async function certainlyStale(
  db: RevisionReader,
  args: {
    dialect: SupportedDialect;
    table: string;
    id: string;
    given: DecodedVersion;
    /** The languages the save is judged on, compared as the main row is. */
    languages?: StaleWrite["languages"];
  }
): Promise<boolean> {
  const inHand = await readDocumentRevision(db, {
    dialect: args.dialect,
    table: args.table,
    id: args.id,
    ...(args.languages ? { languages: args.languages } : {}),
  });
  if (inHand === undefined) return false;
  // Not the version stored: a counter only goes up, so one below it is out of
  // date for good, and one above it is one no read of this document gave.
  return (
    inHand.main.counter !== args.given.main ||
    Object.values(inHand.languages).some(
      language =>
        language.counter !== languageCounterOf(args.given, language.part)
    )
  );
}

/**
 * Judge, inside the write's transaction and before it writes anything, a
 * save's main row: whether it moved since the version given, and the state
 * read. Read under the row lock (`forUpdate`): on MySQL a plain read returns
 * what the transaction saw when it began, which a save in a caller's longer
 * transaction could have read long before. An overwrite is never stale; what
 * it saves over is in the state returned.
 */
export async function judgeMainRow(
  tx: RevisionReader,
  dialect: SupportedDialect,
  check: VersionCheck,
  row: {
    table: string;
    id: string;
    /**
     * The languages the save is judged on, compared before any write as the
     * main row is: read plainly, under the main-row lock every writer of a
     * translation row takes first, so no gap of the table's key is locked.
     * The save's own write of its language claims that row's version again,
     * for a caller whose transaction saw an older snapshot.
     */
    languages?: StaleWrite["languages"];
  }
): Promise<{ stale: boolean; before?: DocumentRevisionState }> {
  if (check.kind === "unjudged") return { stale: false };
  const before = await readDocumentRevision(tx, {
    dialect,
    table: row.table,
    id: row.id,
    forUpdate: true,
  });
  const languages =
    before && row.languages && row.languages.locales.length > 0
      ? await readDocumentRevision(tx, {
          dialect,
          table: row.table,
          id: row.id,
          languages: row.languages,
        })
      : undefined;
  if (before && languages) before.languages = languages.languages;
  const stale =
    before !== undefined &&
    check.kind === "judge" &&
    staleParts(check.given, {
      main: before.main,
      languages: Object.values(before.languages),
    }).length > 0;
  return { stale, before };
}

/** {@link judgeMainRow}, refusing a stale save by throwing, for a write whose refusal rolls everything back. */
export async function refuseIfMainMoved(
  tx: RevisionReader,
  dialect: SupportedDialect,
  check: VersionCheck,
  row: {
    table: string;
    id: string;
    /** The languages the save is judged on, for the version a refusal names. */
    languages?: StaleWrite["languages"];
  },
  holder: StaleWriteHolder
): Promise<DocumentRevisionState | undefined> {
  const judged = await judgeMainRow(tx, dialect, check, row);
  if (!judged.stale) return judged.before;
  holder.at = {
    table: row.table,
    ...(row.languages ? { languages: row.languages } : {}),
  };
  throw NextlyError.staleVersion({
    data: { currentVersion: String(judged.before?.main.counter) },
  });
}

/** The translation row a save writes, and the language it is judged on. */
export interface LanguageWrite {
  table: string;
  id: string;
  languagesTable: string;
  /** The language the save is judged on, if any (`judgedLanguage`). */
  judged: string | undefined;
  /** The language whose row the save writes. */
  written: string;
}

/**
 * Judge a save's language, as its first write of that language's row and
 * before any other write: a judged save claims the row's next version by
 * compare-and-set (`claimCompanionRevision`), so a stale one is found with
 * nothing of it written, whatever the transaction goes on to do. An
 * overwrite claims nothing; the row is read as it is before the write, so
 * what it replaces can be told, and it is never stale.
 *
 * Call only when the save writes that row, or a first translation's claim
 * would leave an empty row behind.
 *
 * @returns `claimed` when the version was taken here, so the write that
 *   follows must not move it again.
 */
export async function judgeLanguageRow(
  tx: RevisionReader & Pick<TransactionContext, "execute">,
  dialect: SupportedDialect,
  check: VersionCheck,
  row: LanguageWrite,
  savedBy: RequestActor
): Promise<{ stale: boolean; claimed: boolean; before?: PartState }> {
  if (check.kind === "unjudged" || row.judged !== row.written) {
    return { stale: false, claimed: false };
  }
  if (check.kind === "overwrite") {
    const read = await readDocumentRevision(tx, {
      dialect,
      table: row.table,
      id: row.id,
      languages: { table: row.languagesTable, locales: [row.written] },
    });
    return {
      stale: false,
      claimed: false,
      before: read?.languages[row.written],
    };
  }
  const claimed = await claimCompanionRevision(
    tx,
    dialect,
    row.languagesTable,
    row.id,
    row.written,
    languageCounterOf(check.given, row.written),
    savedBy
  );
  return { stale: !claimed, claimed };
}

/** {@link judgeLanguageRow}, refusing a stale save by throwing, for a write whose refusal rolls everything back. */
export async function refuseIfLanguageMoved(
  tx: RevisionReader & Pick<TransactionContext, "execute">,
  dialect: SupportedDialect,
  check: VersionCheck,
  row: LanguageWrite,
  savedBy: RequestActor,
  holder: StaleWriteHolder
): Promise<{ claimed: boolean; before?: PartState }> {
  const judged = await judgeLanguageRow(tx, dialect, check, row, savedBy);
  if (!judged.stale) return judged;
  holder.at = {
    table: row.table,
    languages: { table: row.languagesTable, locales: [row.written] },
  };
  throw NextlyError.staleVersion({ data: { currentVersion: "unknown" } });
}

/**
 * The languages a judgement reads beside the document's own row
 * (`judgeMainRow`): a translation table and the languages judged on it, or
 * none where the document keeps no translations or none is judged.
 */
export function languagesJudged(
  table: string | null,
  locales: readonly string[] | undefined
): StaleWrite["languages"] {
  return table !== null && locales && locales.length > 0
    ? { table, locales }
    : undefined;
}

/**
 * The judged languages' rows as the judgement read them, before the write:
 * what an overwrite of all of them saved over.
 */
export function judgedLanguageStates(
  state: DocumentRevisionState | undefined,
  locales: readonly string[] | undefined
): PartState[] | undefined {
  if (!state || !locales) return undefined;
  return locales.flatMap(locale =>
    state.languages[locale] ? [state.languages[locale]] : []
  );
}

/**
 * The refusal of an update found out of date, read from the document as it
 * now is, once the write's transaction has rolled back: so it names the save
 * that came in between, never the refused one.
 */
export async function staleVersionErrorFor(
  db: RevisionReader,
  args: ChangeSinceArgs
): Promise<NextlyError> {
  const reading = await changeReading(db, args);
  if (!reading) {
    return NextlyError.notFound({
      logContext: {
        reason: "stale-version-document-gone",
        slug: args.slug,
        id: args.id,
      },
    });
  }
  const data = await staleVersionData(reading);
  return NextlyError.staleVersion({
    data,
    logContext: {
      reason: "stale-version",
      scopeKind: args.scopeKind,
      slug: args.slug,
      id: args.id,
      given: args.given,
      current: reading.currentVersion,
    },
  });
}

/** What a change since a given version is read from: the document, and who is asking. */
export interface ChangeSinceArgs {
  dialect: SupportedDialect;
  scopeKind: "collection" | "single";
  slug: string;
  id: string;
  given: DecodedVersion;
  at: StaleWrite;
  /**
   * Read inside a transaction the write shares with others: the read gate
   * and the people lookup read on the pool, which waits behind that
   * transaction on SQLite, so only a trusted caller is told who and when,
   * and the changer is not named.
   */
  inSharedTransaction?: boolean;
  reader: Omit<
    Parameters<typeof callerMayReadDocument>[0],
    "scopeKind" | "slug" | "entryId"
  >;
}

/**
 * The document as it now is, in the parts `args.at` covers, with what a
 * description of its change since `args.given` needs. Undefined when the
 * document is gone.
 */
async function changeReading(
  db: RevisionReader,
  args: ChangeSinceArgs
): Promise<(StaleVersionDataArgs & { stale: boolean }) | undefined> {
  const locales = args.at.languages?.locales ?? [];
  const state = await readDocumentRevision(db, {
    dialect: args.dialect,
    table: args.at.table,
    id: args.id,
    ...(args.at.languages && locales.length > 0
      ? { languages: { table: args.at.languages.table, locales } }
      : {}),
  });
  if (!state) return undefined;
  const languages = locales.flatMap(code =>
    state.languages[code] ? [state.languages[code]] : []
  );
  // The part a one-language save writes, for the history version: a save of
  // every language, or of none, writes the part with no language.
  const locale = locales.length === 1 ? locales[0] : undefined;
  return {
    stale: staleParts(args.given, { main: state.main, languages }).length > 0,
    given: args.given,
    currentVersion: encodeDocumentVersion(
      state.main.counter,
      languages.length > 0
        ? Object.fromEntries(languages.map(part => [part.part, part.counter]))
        : undefined
    ),
    parts: [state.main, ...languages],
    mayRead: () =>
      args.inSharedTransaction
        ? Promise.resolve(args.reader.trusted)
        : callerMayReadDocument({
            scopeKind: args.scopeKind,
            slug: args.slug,
            entryId: args.id,
            ...args.reader,
            locales,
          }),
    namePeople: !args.inSharedTransaction,
    // History is read on the pool, so not inside a shared transaction.
    ...(args.inSharedTransaction
      ? {}
      : {
          historyVersion: () =>
            newestHistoryVersion({
              scopeKind: args.scopeKind,
              slug: args.slug,
              id: args.id,
              locale: locale ?? null,
              reader: args.reader,
            }),
        }),
  };
}

/**
 * What changed in a document since `args.given`, in the parts `args.at`
 * covers, described exactly as a refused save would describe it
 * (`staleVersionErrorFor`): null when nothing it covers moved, and "gone"
 * when the document no longer exists.
 *
 * @experimental
 */
export async function changesSinceVersion(
  db: RevisionReader,
  args: ChangeSinceArgs
): Promise<StaleVersionPublicData | null | "gone"> {
  const reading = await changeReading(db, args);
  if (!reading) return "gone";
  if (!reading.stale) return null;
  return staleVersionData(reading);
}

/**
 * The version a client sent, decoded, or undefined when it sent none or one
 * that is not a version: for a reader that compares a stored version rather
 * than judging a write, which refuses a malformed one instead.
 */
export function storedVersionOf(raw: unknown): DecodedVersion | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    return decodeDocumentVersion(raw);
  } catch (error) {
    if (NextlyError.is(error)) return undefined;
    throw error;
  }
}

/**
 * The newest recorded version of one part of a document's history, for a
 * client to compare against what it holds: what the comparison routes take
 * (`compareDocumentVersions`, by version number, within one part). Undefined
 * where the document keeps no history, the part has no version yet, or the
 * caller may not read that part's history, which is asked as the history
 * routes ask it (`assertHistoryLocalesReadable`).
 */
async function newestHistoryVersion(args: {
  scopeKind: "collection" | "single";
  slug: string;
  id: string;
  locale: string | null;
  reader: Omit<
    Parameters<typeof callerMayReadDocument>[0],
    "scopeKind" | "slug" | "entryId"
  >;
}): Promise<StaleVersionPublicData["historyVersion"]> {
  if (!args.reader.trusted) {
    if (!args.reader.user) return undefined;
    // Loaded when a refusal is built, as the read gate is.
    const { assertHistoryLocalesReadable } = await import(
      "../../api/versions-access"
    );
    try {
      await assertHistoryLocalesReadable(
        args.scopeKind,
        args.slug,
        args.id,
        args.reader.user,
        args.reader.authenticatedScope,
        args.reader.hookInputs ?? {},
        [args.locale]
      );
    } catch (error) {
      if (NextlyError.is(error) && error.code === "NOT_FOUND") return undefined;
      throw error;
    }
  }
  const { getService } = await import("../../di");
  const versions = await getService("versionsService").listPartVersions({
    scopeKind: args.scopeKind,
    scopeSlug: args.slug,
    entryId: args.id,
  });
  const newest = versions
    .filter(version => version.locale === args.locale)
    .reduce<
      number | undefined
    >((max, version) => (max === undefined || version.versionNo > max ? version.versionNo : max), undefined);
  return newest === undefined
    ? undefined
    : { version: newest, locale: args.locale };
}
