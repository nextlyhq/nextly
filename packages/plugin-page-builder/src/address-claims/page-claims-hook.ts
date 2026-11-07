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
  claimAddress,
  reconcileHolder,
  releaseClaims,
  type Claims,
  sharePending,
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
  /** Where the host serves its pages (`pagePreviewPath`), if it says. */
  readonly pathTemplate?: string;
  /** Whether the start-up pass has claimed every existing page. */
  readonly backfillDone: () => boolean;
  /**
   * The published pages whose slugs start with `prefix`, oldest first, as
   * committed: the pages a new list's later pages would fall on.
   */
  readonly pagesUnder: (
    prefix: string
  ) => Promise<readonly Readonly<Record<string, unknown>>[]>;
}

/** The slice of the in-transaction write the hook reads. */
interface PageWrite {
  readonly operation: "create" | "update" | "delete";
  readonly id: unknown;
  readonly data: unknown;
  readonly user?: unknown;
  readonly transaction: Tx;
  /** The same for every call on one transaction. */
  readonly transactionKey?: object;
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
async function holdPageClaims(
  write: PageWrite,
  deps: PageClaimsDeps
): Promise<void> {
  if (typeof write.id !== "string" && typeof write.id !== "number") return;
  const holder: Holder = { collection: deps.pages, id: String(write.id) };
  // Every page saved in this transaction keeps its claims with the others',
  // so two pages saved together see each other's.
  if (write.transactionKey !== undefined) {
    sharePending(write.transaction, write.transactionKey);
  }
  if (write.operation === "delete") {
    await releaseClaims(deps.claims, write.transaction, holder);
    return;
  }
  if (typeof write.data !== "object" || write.data === null) return;
  const data = write.data as Record<string, unknown>;
  if (data._isWorkingDraft === true) return;
  const wanted = pageClaims(data, deps.locales(), deps.pathTemplate);
  const describe = describeFor(deps);
  // Until the start-up pass has claimed every existing page, a list's later
  // pages could be taken over a page published among them that holds no
  // claim yet. So the pages already there are claimed first, in this save's
  // transaction, and the list's claim is then refused naming them.
  if (!deps.backfillDone() && wanted.spaces.length > 0) {
    await claimPagesUnder(write.transaction, data, holder, deps, describe);
  }
  await reconcileHolder(
    deps.claims,
    write.transaction,
    holder,
    wanted,
    describe
  );
}

/**
 * Claim the address of every published page among the later pages of the
 * list on the page `data` describes, other than that page itself.
 */
async function claimPagesUnder(
  tx: Tx,
  data: Readonly<Record<string, unknown>>,
  holder: Holder,
  deps: PageClaimsDeps,
  describe: DescribeHolder
): Promise<void> {
  if (typeof data.slug !== "string") return;
  const prefix = data.slug === "" ? "page/" : `${data.slug}/page/`;
  for (const row of await deps.pagesUnder(prefix)) {
    const id = row.id;
    if (typeof id !== "string" && typeof id !== "number") continue;
    if (String(id) === holder.id) continue;
    if (typeof row.slug !== "string" || !row.slug.startsWith(prefix)) continue;
    const other: Holder = { collection: deps.pages, id: String(id) };
    for (const address of pageClaims(row, deps.locales(), deps.pathTemplate)
      .addresses) {
      await claimAddress(deps.claims, tx, { address, holder: other, describe });
    }
  }
}

/**
 * How a refusal names the document holding an address: by its title where
 * a visitor may read it (`the page "About us" (abc123)`), which a published
 * page is, and by its id alone where not (`a page (abc123)`). Read as the
 * public rather than as the person saving, because a save's API key may
 * hold narrower grants than its owner and the write does not carry them:
 * naming only what the public may read leaks nothing to any caller.
 */
function describeFor(deps: PageClaimsDeps): DescribeHolder {
  return async holder => {
    const config = await deps.collection(holder.collection).catch(() => null);
    const label = singularLabel(config);
    const row = await readAsPublic(holder, deps).catch(() => null);
    if (typeof row !== "object" || row === null) {
      return `${article(label)} ${label} (${holder.id})`;
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

/** The holder as a visitor reads it: published, and only if public. */
async function readAsPublic(
  holder: Holder,
  deps: PageClaimsDeps
): Promise<unknown> {
  const nextly = await deps.nextly();
  return nextly.findByID({
    collection: holder.collection,
    id: holder.id,
    overrideAccess: false,
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
