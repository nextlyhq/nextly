/**
 * A page's address claims, written in the same transaction as the save that
 * takes or gives them up.
 *
 * Registered on core's in-transaction phase for the Pages collection, so
 * every write path holds them: the admin, REST, the Direct API, a batch, a
 * release and a scheduled publish. A refused claim throws a conflict naming
 * the other document, which rolls the whole save back, so a page is never
 * stored published at an address another document holds.
 *
 * @module address-claims/page-claims-hook
 */
import { readableTitleText } from "nextly/config";

import { titleFieldIn } from "../entries-route";

import {
  reconcileHolder,
  releaseClaims,
  type Claims,
  type DescribeHolder,
  type Holder,
  type Tx,
} from "./claim-store";
import { pageClaims } from "./page-claims";

/** The one Direct API read the naming makes. */
export interface ReadsById {
  findByID(args: Record<string, unknown>): Promise<unknown>;
}

/** What the page claims need, resolved per save. */
export interface PageClaimsDeps {
  /** The Pages collection's slug, as the host named it. */
  readonly pages: string;
  readonly claims: Claims;
  /** The languages a page's address is held in. */
  readonly locales: () => readonly string[];
  /** The Direct API, for naming the document an address is held by. */
  readonly nextly: () => Promise<ReadsById>;
  /** A collection's configuration, for its label and title field. */
  readonly collection: (slug: string) => Promise<unknown>;
}

/** The slice of the in-transaction write the hook reads. */
interface PageWrite {
  readonly operation: "create" | "update" | "delete";
  readonly id: unknown;
  readonly data: unknown;
  readonly user?: unknown;
  readonly transaction: Tx;
}

/** Where the hook is registered: core's in-transaction phase. */
interface InTransactionHooks {
  onInTransaction(
    collection: string,
    handler: (write: PageWrite) => Promise<void>
  ): void;
}

/** Register the Pages collection's claims on `hooks`. */
export function registerPageAddressClaims(
  hooks: InTransactionHooks,
  deps: PageClaimsDeps
): void {
  hooks.onInTransaction(deps.pages, write => holdPageClaims(write, deps));
}

/**
 * Hold what the page the write leaves should hold: release everything for a
 * deleted page, leave a save held as a working draft alone (the live page
 * keeps its address), and otherwise reconcile its claims with its address
 * and paginated list, in the write's own transaction.
 */
export async function holdPageClaims(
  write: PageWrite,
  deps: PageClaimsDeps
): Promise<void> {
  if (typeof write.id !== "string" && typeof write.id !== "number") return;
  const holder: Holder = { collection: deps.pages, id: String(write.id) };
  if (write.operation === "delete") {
    await releaseClaims(deps.claims, write.transaction, holder);
    return;
  }
  if (typeof write.data !== "object" || write.data === null) return;
  const data = write.data as Record<string, unknown>;
  if (data._isWorkingDraft === true) return;
  await reconcileHolder(
    deps.claims,
    write.transaction,
    holder,
    pageClaims(data, deps.locales()),
    describeFor(write.user, deps)
  );
}

/**
 * How a refusal names the document holding an address, for the person
 * saving: `the page "About us" (abc123)` where they may read it, and
 * `a page you cannot open (abc123)` where not, so a refusal never shows a
 * title its reader could not otherwise see. Without a person (trusted code)
 * the document is read as the site.
 */
function describeFor(user: unknown, deps: PageClaimsDeps): DescribeHolder {
  return async holder => {
    const config = await deps.collection(holder.collection).catch(() => null);
    const label = singularLabel(config);
    const row = await readHolder(holder, user, deps).catch(() => null);
    if (typeof row !== "object" || row === null) {
      return `${article(label)} ${label} you cannot open (${holder.id})`;
    }
    const titleField =
      typeof config === "object" && config !== null
        ? (titleFieldIn(config)?.name ?? "title")
        : "title";
    const title = readableTitleText(
      (row as Record<string, unknown>)[titleField]
    );
    return title === undefined
      ? `the ${label} ${holder.id}`
      : `the ${label} "${title}" (${holder.id})`;
  };
}

/** The holder as the person saving may read it, or as the site without one. */
async function readHolder(
  holder: Holder,
  user: unknown,
  deps: PageClaimsDeps
): Promise<unknown> {
  const nextly = await deps.nextly();
  const asPerson =
    typeof user === "object" && user !== null
      ? { overrideAccess: false, user }
      : { overrideAccess: true };
  return nextly.findByID({
    collection: holder.collection,
    id: holder.id,
    ...asPerson,
    status: "all",
    depth: 0,
  });
}

/** A collection's singular label, lower-cased, as a sentence names it. */
function singularLabel(config: unknown): string {
  const labels =
    typeof config === "object" && config !== null
      ? (config as { labels?: { singular?: unknown } }).labels
      : undefined;
  const singular = labels?.singular;
  return typeof singular === "string" && singular.trim() !== ""
    ? singular.trim().toLowerCase()
    : "document";
}

/** "a" or "an", by the word's first letter. */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}
