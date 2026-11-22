/**
 * What the entry address claims are handed: the claim store and the reads
 * of templates, own designs, entries and pages they judge with, and the
 * write and in-transaction hook shapes core gives them.
 *
 * Part of the entry address claims. `entry-claims-hook.ts` is the entry, and
 * its header explains when an entry holds, waits for or gives up an address.
 *
 * @module address-claims/entry-claims-deps
 */

import type { ServedAddress } from "./claim-key";
import type { Claims, DescribeHolder, Tx } from "./claim-store";

/** A committed row as the walks read it. */
export type Row = Readonly<Record<string, unknown>>;

/** A collection's template as the claims read it, as last committed. */
export interface ServingTemplate {
  readonly published: boolean;
  /** The address it stores, as segments, or null for none. */
  readonly address: readonly string[] | null;
}

/** An entry's published own design as the claims read it. */
export interface OwnDesign {
  /** Whether it splits a list into pages (see `splitsList`). */
  readonly paginates: boolean;
}

/** A published page as the pre-claim reads it: its id and what it holds. */
export interface PageHolding {
  readonly id: string;
  readonly addresses: readonly ServedAddress[];
  readonly spaces: readonly ServedAddress[];
}

/** What entries' claims need, resolved per save. */
export interface EntryClaimsDeps {
  readonly claims: Claims;
  /** Each address declared in code, as segments, by collection slug. */
  readonly addresses: ReadonlyMap<string, readonly string[]>;
  /** The templates collection's slug, as the host named it. */
  readonly templates: string;
  /** The languages an entry's address is held in. */
  readonly locales: () => readonly string[];
  /**
   * `collection`'s template, or null when it has none: as last committed, or,
   * given a save's transaction, read on that transaction's own connection
   * (and held against writes until it ends), so a save asking takes no
   * second connection from the pool while it holds one.
   */
  readonly templateOf: (
    collection: string,
    tx?: Tx
  ) => Promise<ServingTemplate | null>;
  /**
   * The entry `id` of `collection`'s own design, or null when it has no
   * published one, read on `tx`, the write's own transaction, as the
   * template is, so a save asking takes no second connection from the pool
   * while it holds one.
   */
  readonly publishedOwnDesign: (
    collection: string,
    id: string,
    tx: Tx
  ) => Promise<OwnDesign | null>;
  /**
   * The published own designs of `collection`'s entries, by entry id, read
   * on `tx`, the write's own transaction.
   */
  readonly publishedDesigns: (
    collection: string,
    tx: Tx
  ) => Promise<ReadonlyMap<string, OwnDesign>>;
  /**
   * Whether `collection`'s published template splits a list into pages
   * (false where it has none published), read on `tx`, the write's own
   * transaction, so a template's write is read as it leaves the template;
   * as last committed without one.
   */
  readonly templatePaginates: (collection: string, tx?: Tx) => Promise<boolean>;
  /**
   * The entries of `collection` among `ids`, published or not, as the
   * write's transaction `tx` sees them, in one read: the hook asks at most
   * `BATCH` ids at a time, and an id with no entry is left out. Read on the
   * transaction's own connection, so a write asking takes no second
   * connection from the pool while it holds one.
   */
  readonly entriesWithIds: (
    collection: string,
    ids: readonly string[],
    tx: Tx
  ) => Promise<readonly Row[]>;
  /**
   * Every collection whose template stores an address, with it as segments,
   * as last committed.
   */
  readonly storedAddresses: () => Promise<
    ReadonlyMap<string, readonly string[]>
  >;
  /**
   * Whether `collection` is one whose writes never move an entry's address,
   * known without a read: the page builder's own collections, whose
   * documents are not entries served under a template address, and one the
   * site's code declares that no template may serve and no address in code
   * names, such as another plugin's private records.
   */
  readonly neverServed: (collection: string) => boolean;
  /**
   * Whether `collection` may have a template at all (a `slug` text field,
   * shown in the admin, not localized): one that has a template still but
   * may no longer serves nothing, and the start-up pass gives its entries'
   * addresses up. Given a write's transaction, read on it.
   */
  readonly mayHaveTemplate: (collection: string, tx?: Tx) => Promise<boolean>;
  /**
   * Why a stored address cannot be `address` for `collection`, judged
   * without reading, or null: the guard's own words, asked again of the
   * template as its write leaves it, whichever path the write took.
   */
  readonly storedAddressProblem: (
    address: unknown,
    collection: string
  ) => string | null;
  /**
   * Whether `collection` has a Draft/Published lifecycle: without one,
   * every entry is live, whatever a field named `status` holds. Read on
   * `tx`, the write's own transaction, so a save asking takes no second
   * connection from the pool while it holds one; as last committed without
   * one.
   */
  readonly lifecycle: (collection: string, tx?: Tx) => Promise<boolean>;
  /** The Pages collection's slug, as the host named it. */
  readonly pages: string;
  /** Whether the start-up pass has claimed every existing page. */
  readonly pagesBackfilled: () => boolean;
  /**
   * The published pages whose slug is one of `slugs`, with the addresses
   * and list spaces each holds: the pages an entry's address could fall on
   * before the start-up pass has claimed them. Read on the write's own
   * transaction `tx`, so a write holding the pool's last connection never
   * waits for a second one.
   */
  readonly pagesWithSlugs: (
    slugs: readonly string[],
    tx: Tx
  ) => Promise<readonly PageHolding[]>;
  /**
   * Every published page, a batch at a time, with what each holds, read on
   * `tx`, the write's own transaction, so a write holding the pool's last
   * connection never waits for a second one: the pages an entry's list's
   * later pages could fall on before the start-up pass has claimed them.
   * Every one is read, since under a host's page path (`/{slug}/{title}`) a
   * page's slug says nothing about where it is served.
   */
  readonly publishedPagesOn: (tx: Tx) => AsyncIterable<readonly PageHolding[]>;
  /**
   * One page (from 1) of `collection`'s published entries, by id, `size` to
   * a page: every entry where the collection has no Draft/Published
   * `lifecycle`. Read on the write's own transaction `tx`, so a write
   * holding the pool's last connection never waits for a second one.
   */
  readonly publishedEntries: (
    collection: string,
    page: number,
    size: number,
    tx: Tx,
    lifecycle: boolean
  ) => Promise<readonly Row[]>;
  /**
   * Names the document an address is held by, in a refusal, reading it on
   * the write's own transaction, so naming it takes no second connection
   * from the pool while the save holds one.
   */
  readonly describe: (tx: Tx) => DescribeHolder;
}

/** The slice of an in-transaction write the hooks read. */
export interface HostWrite {
  /** The collection written to, or `single:<slug>` for a Single. */
  readonly collection?: string;
  readonly operation: "create" | "update" | "delete";
  readonly id: unknown;
  readonly data: unknown;
  readonly originalData?: unknown;
  readonly transaction: Tx;
  /** The same for every call on one transaction. */
  readonly transactionKey?: object;
}

/** Where the hooks are registered: core's in-transaction phase. */
export interface InTransactionHooks {
  onInTransaction(
    collection: string,
    handler: (write: HostWrite) => Promise<void>
  ): void;
}
