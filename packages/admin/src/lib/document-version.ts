/**
 * The admin's side of a document's version.
 *
 * Every read of an entry or a Single carries its version (`_rev`), an opaque
 * string the editor sends back with each save of that copy. A save made from
 * an older version than the stored one is refused with `STALE_VERSION`, whose
 * data says what the version now is and, to a reader, who changed it and
 * when. The keys are spelled here, once for the whole admin: the server's
 * constants live in modules that import its database code, which the admin's
 * bundle must never reach. `document-version.test.ts` pins them to the
 * server's.
 *
 * @module lib/document-version
 */
import { isApiError } from "./api/parseApiError";

/** The key a read puts the version under, and a write sends it back in. */
export const DOCUMENT_VERSION_KEY = "_rev";

/** The key a write sets to save over a newer version on purpose. */
export const DOCUMENT_OVERWRITE_KEY = "_overwrite";

/** The key a bulk update by ids sends each document's version under. */
export const DOCUMENT_REVS_KEY = "revs";

/**
 * The language a read names to read every language at once: the one read
 * whose version names them all.
 */
export const EVERY_LANGUAGE = "all";

/** The code and status of the refusal of a save made from an older version. */
export const STALE_VERSION_CODE = "STALE_VERSION";
export const STALE_VERSION_STATUS = 409;

/** Who or what made the change a refusal names, as the server describes them. */
export interface VersionChanger {
  kind: string;
  /** A person's name as their account gives it now; null for anyone else. */
  name: string | null;
}

/** What a refusal of a save made from an older version says. */
export interface StaleVersion {
  /** The version the document holds now, spelled for the save's languages. */
  currentVersion: string;
  /** Who or what changed it last: only to a caller who may read it. */
  changedBy?: VersionChanger;
  /** When, as an ISO 8601 time: only to a caller who may read it. */
  changedAt?: string;
  /**
   * The newest history version of the part the save writes, where the
   * document keeps history and the caller may read it: what a comparison
   * starts from.
   */
  historyVersion?: { version: number; locale: string | null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The version a read put on `doc`, or undefined where it carries none. */
export function versionOf(doc: unknown): string | undefined {
  if (!isRecord(doc)) return undefined;
  const version = doc[DOCUMENT_VERSION_KEY];
  return typeof version === "string" && version.length > 0
    ? version
    : undefined;
}

/**
 * What a refusal of a save made from an older version says, from the error a
 * write threw; undefined for any other failure. Each optional part is kept
 * only when it has the shape the server gives it, so a malformed one is left
 * out rather than shown.
 */
/**
 * What a discard refused because the document changed since says, once the
 * document is read again.
 */
export const DISCARD_CHANGED_SINCE =
  "This document changed since you opened it. It now shows the current version; discard again if you still want to.";

export function staleVersionOf(error: unknown): StaleVersion | undefined {
  if (!isApiError(error)) return undefined;
  if (
    error.status !== STALE_VERSION_STATUS ||
    error.code !== STALE_VERSION_CODE
  ) {
    return undefined;
  }
  const data = error.data;
  if (!data || typeof data.currentVersion !== "string") return undefined;
  const stale: StaleVersion = { currentVersion: data.currentVersion };
  const by = data.changedBy;
  if (
    isRecord(by) &&
    typeof by.kind === "string" &&
    (by.name === null || typeof by.name === "string")
  ) {
    stale.changedBy = { kind: by.kind, name: by.name };
  }
  if (
    typeof data.changedAt === "string" &&
    !Number.isNaN(Date.parse(data.changedAt))
  ) {
    stale.changedAt = data.changedAt;
  }
  const history = data.historyVersion;
  if (
    isRecord(history) &&
    typeof history.version === "number" &&
    (history.locale === null ||
      history.locale === undefined ||
      typeof history.locale === "string")
  ) {
    stale.historyVersion = {
      version: history.version,
      locale: typeof history.locale === "string" ? history.locale : null,
    };
  }
  return stale;
}

/**
 * Who or what made a change, as a sentence names them: a person by name, and
 * anyone the server names no one for by what they are. "Someone" when the
 * change names nobody, or an account that is gone.
 */
export function changerName(changedBy: VersionChanger | undefined): string {
  if (!changedBy) return "Someone";
  if (changedBy.name?.trim()) return changedBy.name.trim();
  switch (changedBy.kind) {
    case "apiKey":
      return "An API key";
    case "release":
      return "A scheduled release";
    case "agent":
      return "An agent";
    case "system":
      return "Nextly";
    default:
      return "Someone";
  }
}

/**
 * The version a write in `wanted`'s language sends, from an editor showing
 * `shown`: the version its copy started from, for its own language or a
 * write of no language; another language's, which the copy never held, read
 * now. Such a write is judged from that read rather than from what the
 * editor showed, which held none of that language.
 */
export async function versionForLanguage(args: {
  wanted: string | null;
  shown: string | null;
  startedFrom: string | undefined;
  readIn: (locale: string) => Promise<unknown>;
}): Promise<string | undefined> {
  if (args.wanted === null || args.wanted === args.shown) {
    return args.startedFrom;
  }
  return versionOf(await args.readIn(args.wanted));
}

/**
 * Each of `ids`' version, for a bulk update's `revs`: only where every one
 * has a version, since the server refuses versions given for some documents
 * and not others. Undefined otherwise, and for no documents.
 */
export function revsFor(
  ids: readonly string[],
  versions: Readonly<Record<string, string>>
): Record<string, string> | undefined {
  if (ids.length === 0) return undefined;
  const revs: Record<string, string> = {};
  for (const id of ids) {
    const version = versions[id];
    if (version === undefined) return undefined;
    revs[id] = version;
  }
  return revs;
}
