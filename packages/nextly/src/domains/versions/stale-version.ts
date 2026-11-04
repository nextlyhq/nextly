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
 * changed it last (`lastChangerOf`), and the refusal (`staleVersionRefusal`).
 *
 * @module domains/versions/stale-version
 * @experimental
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { NextlyError } from "../../errors/nextly-error";
import type { StaleVersionPublicData } from "../../errors/public-data";
import { DOCUMENT_VERSION_KEY } from "../../lib/system-columns";
import { COMPANION_UPDATED_AT_COLUMN } from "../i18n/companion-columns";

import type { UserContext } from "../singles/types";

import { peopleById } from "./author-hydration";
import { DOCUMENT_REVISION_COLUMN } from "./document-revision";

/** A version as its parts: the main counter, and each language's it names. */
export interface DecodedVersion {
  main: number;
  languages: Readonly<Record<string, number>>;
}

// `7`, `7.es:3`, `7.en:2,es:3`: what `encodeDocumentVersion` spells. A
// language code holds letters, digits and `-` (`pt-BR`), never `.`, `:` or `,`.
const VERSION_PATTERN = /^(\d+)(?:\.([A-Za-z0-9-]+:\d+(?:,[A-Za-z0-9-]+:\d+)*))?$/;

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
export function decodeDocumentVersion(raw: unknown): DecodedVersion {
  const match = typeof raw === "string" ? VERSION_PATTERN.exec(raw) : null;
  if (!match) {
    throw unjudgeable(
      `${DOCUMENT_VERSION_KEY} must be the version a read returned, such as "7" or "7.es:3".`
    );
  }
  const main = Number(match[1]);
  if (!Number.isSafeInteger(main) || main < 1) {
    throw unjudgeable(`${DOCUMENT_VERSION_KEY} names a version no document has.`);
  }
  const languages: Record<string, number> = {};
  for (const part of match[2]?.split(",") ?? []) {
    const [code, counter] = part.split(":");
    const n = Number(counter);
    if (code in languages || !Number.isSafeInteger(n)) {
      throw unjudgeable(`${DOCUMENT_VERSION_KEY} names a version no document has.`);
    }
    languages[code] = n;
  }
  return { main, languages };
}

/**
 * What an update is judged against: the version it gave, or nothing.
 *
 * One decision, taken once at each write path's boundary, before the body's
 * version is dropped: a write with no `_rev`, or one the server exempts, is
 * applied as it always was.
 */
export type VersionCheck =
  | { kind: "judge"; given: DecodedVersion; raw: string }
  | { kind: "unjudged" };

/**
 * Decide how `body` is judged.
 *
 * `exempt` comes from trusted server code alone (`releaseRunExemptFor`),
 * never from anything a caller sends: a key in the body, an option or a
 * query that claimed it would let any client skip the check.
 *
 * @throws NextlyError.validation for a `_rev` that is not a version.
 */
export function versionCheckFor(
  body: Readonly<Record<string, unknown>>,
  options: { exempt: boolean }
): VersionCheck {
  if (!(DOCUMENT_VERSION_KEY in body) || body[DOCUMENT_VERSION_KEY] === undefined) {
    return { kind: "unjudged" };
  }
  const raw = body[DOCUMENT_VERSION_KEY];
  // Decoded even when exempt, so a malformed version is refused the same way
  // on every path.
  const given = decodeDocumentVersion(raw);
  if (options.exempt) return { kind: "unjudged" };
  return { kind: "judge", given, raw: raw as string };
}

/**
 * A version given in an update of many documents at once, which names one
 * document's version and cannot be judged against the others'.
 *
 * @throws NextlyError.validation when `body` carries `_rev`.
 */
export function refuseVersionInSharedData(
  body: Readonly<Record<string, unknown>>
): void {
  if (!(DOCUMENT_VERSION_KEY in body) || body[DOCUMENT_VERSION_KEY] === undefined) {
    return;
  }
  throw unjudgeable(
    `${DOCUMENT_VERSION_KEY} names one document's version, so an update of several documents with the same values can't carry it. Update each document with its own version.`
  );
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

function counterOf(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n === "number" && Number.isInteger(n)) return n;
  throw NextlyError.internal({
    logContext: { reason: "document-revision-unreadable", value: String(value) },
  });
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * When a row last changed, as every judgement and every picker orders it: the
 * one source of "when", so no two callers can disagree about which change
 * came last. The row's own update time.
 */
export function changedAtOf(row: Record<string, unknown>, column: string): Date | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  const at = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(at.getTime()) ? null : at;
}

function stateOf(part: string, row: Record<string, unknown>, atColumn: string): PartState {
  return {
    part,
    counter: counterOf(row[DOCUMENT_REVISION_COLUMN]),
    changer: {
      kind: textOrNull(row._changed_by_kind),
      id: textOrNull(row._changed_by_id),
      principalKind: textOrNull(row._changed_by_principal_kind),
    },
    at: changedAtOf(row, atColumn),
  };
}

/** A language with no translation row: counter 0, changed by nobody. */
function absentPart(part: string): PartState {
  return { part, counter: 0, changer: { kind: null, id: null, principalKind: null }, at: null };
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
  db: Pick<TransactionContext, "select" | "execute">,
  args: {
    dialect: SupportedDialect;
    table: string;
    id: string;
    languages?: { table: string; locales: readonly string[] };
    forUpdate?: boolean;
  }
): Promise<DocumentRevisionState | undefined> {
  const [row] = await db.select<Record<string, unknown>>(args.table, {
    columns: [DOCUMENT_REVISION_COLUMN, ...CHANGER_COLUMNS, "updated_at"],
    where: { and: [{ column: "id", op: "=", value: args.id }] },
    limit: 1,
    ...(args.forUpdate ? { forUpdate: true } : {}),
  });
  if (!row) return undefined;
  const state: DocumentRevisionState = {
    main: stateOf("main", row, "updated_at"),
    languages: {},
  };
  const locales = args.languages?.locales ?? [];
  if (!args.languages || locales.length === 0) return state;
  // Named in the statement: a translation table's runtime model does not
  // declare the per-document columns, since the same model serves field-group
  // translation tables, which are no documents.
  const q = (name: string) => (args.dialect === "mysql" ? `\`${name}\`` : `"${name}"`);
  const p = (n: number) => (args.dialect === "postgresql" ? `$${n}` : "?");
  const columns = ["_locale", DOCUMENT_REVISION_COLUMN, ...CHANGER_COLUMNS, COMPANION_UPDATED_AT_COLUMN];
  const rows = (await db.execute(
    `SELECT ${columns.map(q).join(", ")} FROM ${q(args.languages.table)} WHERE ${q("_parent")} = ${p(1)} AND ${q("_locale")} IN (${locales.map((_, i) => p(i + 2)).join(", ")})`,
    [args.id, ...locales]
  )) as Record<string, unknown>[];
  const byLocale = new Map(rows.map(r => [String(r._locale), r]));
  for (const locale of locales) {
    const found = byLocale.get(locale);
    state.languages[locale] = found
      ? stateOf(locale, found, COMPANION_UPDATED_AT_COLUMN)
      : absentPart(locale);
  }
  return state;
}

/**
 * The language a save judges, or undefined where it judges none: a document
 * with no translation table, or a save that writes no translated value.
 *
 * @throws NextlyError.validation when the save writes a language its version
 *   does not name, since that version came from a read of another language.
 */
export function judgedLanguage(
  given: DecodedVersion,
  writeLocale: string | undefined
): string | undefined {
  if (writeLocale === undefined) return undefined;
  if (!(writeLocale in given.languages)) {
    throw unjudgeable(
      `${DOCUMENT_VERSION_KEY} names no version of ${writeLocale}, the language this update saves. Send the version a read of ${writeLocale} returned.`
    );
  }
  return writeLocale;
}

/**
 * The parts of a document that moved since the version given: none when the
 * save may go ahead.
 *
 * `main` compares the main row as read under the lock, before the write.
 * `languageAfterWrite`, where the save wrote its language's row, compares that
 * row as the write left it: its counter is then the given one plus this
 * save's own increment, and anything more is someone else's save.
 */
export function staleParts(
  given: DecodedVersion,
  args: {
    main?: PartState;
    languageAfterWrite?: { locale: string; state: PartState; bumped: boolean };
  }
): string[] {
  const stale: string[] = [];
  if (args.main && args.main.counter !== given.main) stale.push("main");
  const language = args.languageAfterWrite;
  if (language) {
    const expected = (given.languages[language.locale] ?? 0) + (language.bumped ? 1 : 0);
    if (language.state.counter !== expected) stale.push(language.locale);
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
          : part.counter !== (given.languages[part.part] ?? 0)
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
export async function staleVersionRefusal(args: {
  state: DocumentRevisionState;
  given: DecodedVersion;
  /** The current version, as a read of the save's language spells it. */
  currentVersion: string;
  /** The parts the save writes, main first. */
  parts: readonly PartState[];
  mayRead: () => Promise<boolean>;
  logContext: Record<string, unknown>;
}): Promise<NextlyError> {
  const data: StaleVersionPublicData = { currentVersion: args.currentVersion };
  if (await args.mayRead()) {
    const changer = lastChangerOf(args.parts, args.given);
    if (changer && CHANGER_KINDS.has(changer.kind)) {
      const name =
        changer.kind === "person" && changer.id
          ? ((await peopleById([changer.id])).get(changer.id)?.name ?? null) || null
          : null;
      data.changedBy = {
        kind: changer.kind as NonNullable<StaleVersionPublicData["changedBy"]>["kind"],
        name,
        ...(changer.kind === "principal" && changer.principalKind
          ? { principalKind: changer.principalKind }
          : {}),
      };
    }
    if (changer?.at) data.changedAt = changer.at.toISOString();
  }
  return NextlyError.staleVersion({
    data,
    logContext: { ...args.logContext, given: args.given, current: args.currentVersion },
  });
}

/**
 * Whether the caller of a refused update may read the document: the same
 * decision a read of it gets (`assertVersionDocumentReadable`, draft and
 * published visibility, row rules and read hooks included). A trusted server
 * caller may; a caller with no account may not be told who changed it.
 *
 * @experimental
 */
export async function callerMayReadDocument(args: {
  scopeKind: "collection" | "single";
  slug: string;
  entryId: string;
  user: UserContext | undefined;
  trusted: boolean;
  authenticatedScope?: AuthenticatedScope;
  hookInputs?: { request?: Request; context?: Record<string, unknown> };
}): Promise<boolean> {
  if (args.trusted) return true;
  if (!args.user) return false;
  // Loaded when a refusal is built, not with the write path: the gate reads
  // the version and access services, which an ordinary save never needs.
  const { assertVersionDocumentReadable } = await import(
    "../../api/versions-access"
  );
  try {
    await assertVersionDocumentReadable(
      args.scopeKind,
      args.slug,
      args.entryId,
      args.user,
      args.authenticatedScope,
      args.hookInputs ?? {}
    );
    return true;
  } catch (error) {
    // The gate answers "not found" for a document the caller may not read.
    if (NextlyError.is(error) && error.code === "NOT_FOUND") return false;
    throw error;
  }
}
