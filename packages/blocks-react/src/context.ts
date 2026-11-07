import type {
  BindingFieldShape,
  BindingIssue,
  BindingRun,
  BlockRenderArgs as EngineBlockRenderArgs,
  BlockDefinition as EngineBlockDefinition,
  ConditionIssue,
  NamedQueryDeclaration,
  NamedQueryDefinition,
  RemotePatternInput,
  SpacingMode,
} from "@nextlyhq/blocks-engine";
import type { ReactNode } from "react";

/**
 * What a block render receives, and where the renderer gets its data.
 *
 * `BlockRenderArgs<P, C>` in the engine leaves `ctx: C` deliberately unnamed —
 * "what a context CONTAINS is the renderer's to say" — so defining it is this
 * package's contractual obligation, not optional polish.
 *
 * Everything the renderer needs from the outside world arrives through these
 * interfaces rather than through imports. That is what keeps the package usable
 * without the CMS, but the standalone case is the smaller half of the argument:
 * the canvas renders the same documents against different data access, and a
 * test wants fixtures instead of a database. One seam serves every host, and a
 * host that resolves data some other way is a different implementation of these
 * interfaces rather than a change to the renderer.
 *
 * @module context
 */

/** The operators a list's filter row may use, each meaning the same on every database. */
export type BlocksFilterOp =
  | "equals"
  | "not_equals"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "in"
  | "not_in"
  | "exists";

/** One filter row: a field, an operator and a typed value. Never a raw query. */
export interface BlocksFilter {
  field: string;
  op: BlocksFilterOp;
  value: string | number | boolean | readonly (string | number | boolean)[];
}

/**
 * A query the renderer asks its host to answer.
 *
 * Data, not a database query: typed filter rows, sort keys and a window. It is
 * the shape `nextly/runtime`'s public reader takes, written out here because
 * this entry must not import `nextly`; a type test keeps the two the same.
 * Who may see what is not in it, on purpose: that is the reader's to fix.
 */
export interface BlocksQuery {
  collection: string;
  filters?: readonly BlocksFilter[];
  /** One key or several in order, `-field` descending; ties break by id. */
  sort?: string | readonly string[];
  /** 1 to 100. */
  limit?: number;
  /** Rows to skip, from 0. */
  offset?: number;
  /** A page of `limit` rows after the offset, from 1. */
  page?: number;
  locale?: string;
  /** The fields each row carries, besides its id; a relationship as its id. */
  select?: readonly string[];
}

/** What a host returns for a {@link BlocksQuery}. */
export interface BlocksResult {
  items: ReadonlyArray<Record<string, unknown>>;
  total?: number;
}

/**
 * The data seam. The CMS supplies an implementation backed by its own read
 * path; a standalone consumer or a test supplies fixtures.
 *
 * Async by contract even where a host could answer synchronously, because a
 * host that later needs to await must not force every caller to change.
 */
export interface BlocksDataProvider {
  find(query: BlocksQuery): Promise<BlocksResult>;
}

/**
 * The reads a route hands a page's data provider: published entries and
 * public fields only, as an anonymous visitor reads them, in the route's
 * language.
 *
 * The shape of `nextly/runtime`'s `PublicReader`, written out for the same
 * reason as {@link BlocksQuery}. A query that tries to widen the read is
 * refused by the reader, not by the provider, so no provider can forget to.
 *
 * @experimental
 */
export interface BlocksPublicReader {
  /** Nextly's list envelope: the rows, and their pagination with the total. */
  find(query: BlocksQuery): Promise<{
    items: Record<string, unknown>[];
    meta: { total: number };
  }>;
  count(
    query: Pick<BlocksQuery, "collection" | "filters" | "locale">
  ): Promise<number>;
  /**
   * One Single, published, with the fields the public may read, or `null`
   * when there is nothing a visitor may see. Absent from a reader made over a
   * source that cannot read Singles.
   */
  findSingle?(query: {
    slug: string;
    locale?: string;
    select?: readonly string[];
  }): Promise<Record<string, unknown> | null>;
  /**
   * One entry by its id, or `null` when there is none the reader may see.
   * Given by an editor's reader, whose by-id read returns an entry's pending
   * working draft where a list read returns its live row; the page's own entry
   * and each entry a binding follows a relation to are read through it when
   * it is there. A published page's reader has none, and reads them as a
   * list does.
   */
  findById?(query: {
    collection: string;
    id: string | number;
    locale?: string;
    select?: readonly string[];
  }): Promise<Record<string, unknown> | null>;
}

/**
 * The reader a named query's own reader wraps: the shape both a published
 * page and an editor's canvas supply. A published page passes the route's
 * public reader; a canvas passes one reading with the editing person's
 * access. Either way the strict key set holds (no status, no trusted read,
 * no raw `where`), hidden fields are stripped by this reader, and what a
 * query may read of it, and how many times, is decided by the wrapper.
 *
 * @experimental
 */
export interface ListBaseReader extends BlocksPublicReader {
  /** The site settings the reader's caller may read, when it can read them. */
  siteSettings?(): Promise<Readonly<Record<string, unknown>>>;
}

/** What one run of a named query gave, as a page's cache keeps it. */
export interface NamedQueryRunData {
  /** Projected to what the query declares, the key checked. */
  readonly rows: readonly Record<string, unknown>[];
  readonly total?: number;
  /** How many reads it made, claimed again from a page that reuses it. */
  readonly reads: number;
}

/** Why a named query's list drew its empty state. */
export type NamedQueryFailureCode =
  | "unknown"
  | "params"
  | "undeclared-read"
  | "trusted-read"
  | "budget"
  | "timeout"
  | "bad-rows"
  | "rows-hidden"
  | "uncounted"
  | "threw";

/** A named query's failure, as the host logs it. */
export interface NamedQueryFailure {
  readonly code: NamedQueryFailureCode;
  readonly query: string;
  /** The list block that drew its empty state. */
  readonly nodeId: string;
  /** The reference the editor shows in place of the error, `NQ-` and 6 hex. */
  readonly ref: string;
  /** What failed, for the log only; never shown to an author. */
  readonly error?: unknown;
}

/**
 * Where a site's named queries are looked up by name, run function included:
 * the page builder that registered them hands one out per site.
 *
 * @experimental
 */
export interface NamedQueryLookup {
  definitionOf(name: string): NamedQueryDefinition | undefined;
}

/**
 * What a page renders a collection list's named query with: where queries
 * are looked up, the reader each run wraps, and the host's cache, frame and
 * log. Absent, a list whose source is a named query draws its template once,
 * as a list with no data source does.
 *
 * @experimental
 */
export interface NamedQueryHost {
  /**
   * The query registered under a name by the site this page belongs to:
   * each site keeps its own, so two sites served from one process never
   * resolve each other's.
   */
  readonly definitionOf: (name: string) => NamedQueryDefinition | undefined;
  readonly reader: ListBaseReader;
  /** Today in the site's time zone, `YYYY-MM-DD`, one answer per render. */
  readonly today: () => Promise<string>;
  /**
   * The public field shapes of a collection, which rows that are its
   * entries are projected to. A collection it cannot answer for keeps only
   * each row's id and timestamps.
   */
  readonly fieldsOf?: (
    collection: string
  ) => Promise<readonly BindingFieldShape[] | undefined>;
  /**
   * The host's frame for one run of the query `name`: `run` executes the
   * query inside it, where the host refuses every read but the reader's, and
   * `read` is the door the reader handed to the query reads through.
   */
  readonly frame?: (name: string) => {
    run<T>(operation: () => Promise<T>): Promise<T>;
    read<T>(operation: () => Promise<T>): Promise<T>;
  };
  /**
   * What an author is told about a run that succeeded, where a visitor's
   * page would go without part of it: a query reading a collection visitors
   * can't read. Shown only where an author is looking; an editor's canvas
   * gives it, a published page does not.
   */
  readonly caution?: (declaration: NamedQueryDeclaration) => string | undefined;
  /** Keep a run's result across renders, tagged by everything it declares. */
  readonly cache?: (request: {
    readonly declaration: NamedQueryDeclaration;
    readonly key: readonly string[];
    readonly read: () => Promise<NamedQueryRunData>;
    /**
     * The run as the list stores it: its inputs before they are judged, and
     * its window. What a host that runs the query elsewhere (an editor's
     * canvas, on its server) asks for, so the run is judged there as on a
     * published page. Optional, so a host written before it was handed one
     * is still a host; the renderer always hands it.
     */
    readonly asked?: {
      readonly params: Readonly<Record<string, unknown>>;
      readonly window: { readonly limit: number; readonly offset: number };
      /**
       * The reads the render has left, when its allowance can say: a run
       * made elsewhere may spend no more, and none is started at 0.
       */
      readonly allowance?: number;
      /** The list block the run is for, so a failure is logged under it. */
      readonly node?: string;
    };
  }) => Promise<NamedQueryRunData>;
  /**
   * Told about each failed run, for the server log. The failure carries the
   * error as thrown, which may hold whatever the query's code put in it:
   * log it through `namedQueryFailureLine`, which leaves the error's
   * message and values out.
   */
  readonly report?: (failure: NamedQueryFailure) => void;
}

/**
 * How a route builds its data provider: from the public reader it binds to
 * each render.
 *
 * A function rather than a provider, so a route never holds a reader of its
 * own: the one it is given is the one that decides who sees what.
 *
 * @experimental
 */
export type BlocksDataProviderFactory = (
  reader: BlocksPublicReader
) => BlocksDataProvider;

/** Options for {@link createDefaultDataProvider}. */
export interface DefaultDataProviderOptions {
  /**
   * The collections a page's lists may read. A list naming another reads
   * nothing. Absent means every collection the public may read.
   */
  collections?: readonly string[];
}

/**
 * The provider a route uses when it is given none: every list reads through
 * the public reader, optionally limited to some collections.
 *
 * @experimental
 */
export function createDefaultDataProvider(
  reader: BlocksPublicReader,
  options: DefaultDataProviderOptions = {}
): BlocksDataProvider {
  const allowed =
    options.collections === undefined
      ? undefined
      : new Set<string>(options.collections);
  return {
    find: async query => {
      if (allowed !== undefined && !allowed.has(query.collection)) {
        return { items: [], total: 0 };
      }
      const { items, meta } = await reader.find(query);
      return { items, total: meta.total };
    },
  };
}

/**
 * A resolved media item.
 *
 * An object rather than a URL string because an image block needs alt text and
 * intrinsic dimensions to render without layout shift, and those travel with
 * the URL or they get looked up separately and inconsistently. This mirrors the
 * shape the existing renderer already settled on.
 */
export interface ResolvedMedia {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
}

/**
 * A provider that answers nothing.
 *
 * The default, so that rendering a document containing a dynamic block without
 * a configured host produces an empty result rather than a crash — the
 * forgiving-render posture the document model already takes for unknown block
 * types.
 */
export const emptyDataProvider: BlocksDataProvider = {
  find: () => Promise.resolve({ items: [], total: 0 }),
};

/**
 * How many more reads this page render may perform.
 *
 * A loop inside a loop asks its data source once per entry of the outer one, so
 * depth in a document turns into MULTIPLICATION in queries: three nested
 * repeaters over ten entries each is a thousand reads from one page view. The
 * budget is shared by the whole render and claimed before each read, which
 * turns an unbounded page into a bounded one that renders what it could reach.
 *
 * A counter rather than a depth limit, because the cost is the number of reads
 * and not the shape of the tree: one loop over a thousand entries and a
 * thousand loops over one both spend the same.
 */
export interface QueryBudget {
  /**
   * Claim one read. False when the page has spent its allowance.
   *
   * `claim` says what the read is for and which block asked, so a page that
   * outruns its allowance can say what it cost and which blocks went
   * without their data. Optional: a read claimed without one still counts.
   */
  take(claim?: ReadClaim): boolean;
  /**
   * How many reads are left, claiming none: what a host that makes a run
   * elsewhere hands that place, so it never spends more than the page has.
   * Absent on a budget that cannot say.
   */
  remaining?(): number;
  /**
   * What this render's named query runs are kept with: a new object for
   * each render. Absent, the budget itself, which a page makes per render;
   * a budget kept across renders and renewed for each (an editor's canvas)
   * answers the current render's, so no run outlives its render.
   */
  generation?(): object;
  /**
   * What this budget has counted so far. Absent on a budget that does not
   * count, such as one a host wrote itself.
   *
   * @experimental
   */
  report?(): PageReadReport;
}

/**
 * What a read is for, as an author would name it:
 * - `entries`: a list's entries;
 * - `related`: entries reached through a relation, for a list's items or
 *   the page's own bindings;
 * - `image`: a media record;
 * - `link`: where a link to an entry goes, its ownership checks included;
 * - `page`: the page's own data: its entry, a Single, the site settings;
 * - `component`: the components and Layouts the page places.
 *
 * @experimental
 */
export type ReadKind =
  | "entries"
  | "related"
  | "image"
  | "link"
  | "page"
  | "component";

/**
 * Every kind a budget counts, in the order the editor lists them.
 *
 * @experimental
 */
export const READ_KINDS: readonly ReadKind[] = [
  "entries",
  "related",
  "image",
  "link",
  "page",
  "component",
];

/**
 * One read's claim: what it is for, and the block that asked, where a block
 * did. A claim with no kind counts as the page's own data.
 *
 * @experimental
 */
export interface ReadClaim {
  readonly kind?: ReadKind;
  readonly nodeId?: string;
  /**
   * Every block one read serves, where it serves several (a batch of
   * component definitions, for the placements asking for them): each is
   * named unread when the read is refused.
   *
   * @experimental
   */
  readonly nodeIds?: readonly string[];
}

/**
 * The placements asking for each component a read loads, by its id: the
 * blocks an author placed, named unread when that read is refused.
 *
 * @experimental
 */
export type ComponentPlacements = ReadonlyMap<string, readonly string[]>;

/** The placements asking for any of `ids`, each once. */
export function placementsOf(
  ids: readonly string[],
  placements: ComponentPlacements | undefined
): string[] {
  const found = new Set<string>();
  for (const id of ids) {
    for (const placement of placements?.get(id) ?? []) found.add(placement);
  }
  return [...found];
}

/**
 * How many component definitions one read of them asks for.
 *
 * @experimental
 */
export const COMPONENT_BATCH_SIZE = 128;

/**
 * The batches one read of component definitions makes, each claimed as one
 * read before it is made, stopping at the first refused: one claim per
 * query, since a page embedding twenty components spends one read, and
 * charging per definition would refuse a page for an allowance it never
 * spent. The route's own component reads take their batches here, and so
 * does the editor's count of them, so the two cannot count differently.
 *
 * @experimental
 */
export function componentBatches(
  ids: readonly string[],
  budget: QueryBudget,
  /** Who asks for each id, so a refused batch names them unread. */
  placements?: ComponentPlacements
): string[][] {
  const batches: string[][] = [];
  for (let at = 0; at < ids.length; at += COMPONENT_BATCH_SIZE) {
    // A refused batch ends the reads, so it names every placement still
    // waiting: its own and the later batches' it stops.
    const claim: ReadClaim = {
      kind: "component",
      nodeIds: placementsOf(ids.slice(at), placements),
    };
    if (!budget.take(claim)) break;
    batches.push(ids.slice(at, at + COMPONENT_BATCH_SIZE));
  }
  return batches;
}

/** A block drawn without its data, because the page had spent its reads. */
export interface UnreadBlock {
  readonly nodeId: string;
  readonly what: ReadKind;
}

/**
 * One render's count of the reads a page made against its allowance.
 *
 * @experimental
 */
export interface PageReadReport {
  /** The allowance: the route's `maxQueries`, 500 by default. */
  readonly cap: number;
  /** Reads made. Never more than `cap`. */
  readonly used: number;
  /**
   * Reads asked for once the allowance was spent: a lower bound on what the
   * page needs, since a list whose read was refused never asks for its
   * entries' images.
   */
  readonly refused: number;
  /** Reads made, by what they were for. */
  readonly byKind: Readonly<Partial<Record<ReadKind, number>>>;
  /** The blocks whose read was refused, in the order they asked, each once. */
  readonly unread: readonly UnreadBlock[];
}

/**
 * The reads a collection list asks for its entries all at once, before it
 * draws them, so what a list costs does not grow with its length: each
 * relation its items' bindings follow, and each link to an entry its
 * template draws, one read per batch rather than one per entry. (An image
 * costs one read per distinct media id per render through `resolveMedia`.)
 *
 * The links read here prime what `resolveEntryPath` then answers from, so a
 * block drawn inside an entry claims nothing for what was read ahead. A host without it draws each
 * entry's reads one at a time, as before; anything a batch could not settle
 * falls back to that path too.
 *
 * @experimental
 */
export interface ListBatchReads {
  /**
   * The entries a to-one relation of `collection` named `field` points at,
   * by the id each item stores, with `fields` read. `undefined` when the
   * relation cannot be followed (not a to-one relation the public may read,
   * or a read refused or failed): the items keep their ids.
   */
  related(
    collection: string,
    field: string,
    ids: readonly (string | number)[],
    fields: readonly string[],
    claim: ReadClaim
  ): Promise<
    ReadonlyMap<string, Readonly<Record<string, unknown>>> | undefined
  >;
  /**
   * Settle these links' paths ahead, for `resolveEntryPath` to answer from.
   * `false` when it stopped for want of reads, so the list reads nothing
   * more ahead and each later block reads as it is drawn, in page order.
   */
  entryPaths(
    refs: readonly { readonly collection: string; readonly id: string }[],
    claim: ReadClaim
  ): Promise<boolean | void>;
  /**
   * Read these media records ahead, for `resolveMedia` to answer from;
   * `false` when it stopped for want of reads. Optional: a host without it
   * reads each image as it is drawn.
   */
  media?(ids: readonly string[], claim: ReadClaim): Promise<boolean | void>;
}

/**
 * Decisions that belong to the site operator rather than to a page editor.
 *
 * The distinction this type exists to draw: a block's props are CONTENT, filled
 * in by whoever edits the page, and content is untrusted input. A few of the
 * things a block does are not content decisions at all — they are security
 * posture, and the person who should answer them is the developer standing up
 * the site, once, in code they control. Modelling those as props put the answer
 * in a checkbox any editor could tick, against any URL.
 *
 * Supplied to `PageRenderer` and handed to every block as a render ARGUMENT,
 * deliberately not as a field on the context. The context object belongs to the
 * host and is passed through untouched; the policy belongs to the renderer.
 * Putting renderer-owned data on a host-owned object meant deriving a modified
 * copy, and no copy is faithful: a spread loses a class host's prototype
 * methods, and a prototype-preserving clone still fails a method that reads a
 * native private field, because the clone is not branded with it. Threading the
 * value instead means the host's object is never rewritten.
 *
 * It also settles the question of who may set it. A block builds the context it
 * hands `renderSlot`, so a policy living there could be forged by the block or
 * dropped by a container that rebuilt the object. As an argument supplied by
 * the boundary, it can be neither.
 *
 * Every field is optional, and an absent field means one of two different
 * things, so read the field to know which.
 *
 * `trustedFrameOrigins` defaults CLOSED: absent grants nothing, because the
 * grant it controls lets a frame script the page around it, and no host should
 * arrive at that by omission.
 *
 * `remotePatterns` defaults OPEN: absent means the question is not asked at all.
 * It has to, because it arrived after the renderer shipped, and defaulting it
 * closed would stop every existing site loading its own images the day it
 * upgraded. A host that wants remote fetches bounded has to say so.
 *
 * The rule for anything added here later: a field whose closed default would
 * break a site that never configured it defaults open and says so, in the field
 * where someone deciding whether to configure it will read it.
 */
export interface BlockHostPolicy {
  /**
   * Origins whose documents may keep their own origin inside a frame.
   *
   * An iframe granted `allow-same-origin` alongside `allow-scripts` can remove
   * its own sandbox, so this is the one embed decision that cannot be left to
   * content. Entries are compared as ORIGINS — scheme, host and port together,
   * exactly — so `https://player.example.com` does not admit
   * `http://player.example.com`, a subdomain, or a lookalike host.
   *
   * A relative URL never matches, deliberately. It resolves to the host's OWN
   * origin, where `allow-same-origin` would let the frame script the page
   * around it; that is the most dangerous grant of all, and it must be asked
   * for by naming the origin rather than arrived at by writing `/player`. The
   * same refusal covers `https:player.example.com`, which a URL parser reads as
   * an absolute URL while a browser resolves it against the document.
   *
   * **What this cannot do.** Sandbox permissions belong to the frame, not to
   * one navigation, so they survive a redirect: an allowlisted origin that
   * exposes an open redirect can send the frame somewhere unlisted and the
   * grant travels with it. The renderer sees only the URL it writes and cannot
   * constrain where the browser goes next.
   *
   * So an origin listed here is trusted for everything it can redirect to, and
   * a site that needs that bounded should pair this with a `frame-src` content
   * security policy, which is enforced on every navigation rather than only the
   * first. Listing an origin whose redirect behaviour you do not control is the
   * case to avoid.
   */
  trustedFrameOrigins?: readonly string[];
  /**
   * Hosts this site will fetch from, in `next/image`'s `remotePatterns` shape.
   *
   * A page fetches from more than one channel. A block writes an `<img src>` or
   * an `<iframe src>`; a compiled stylesheet writes `url(...)` into a rule that
   * fires on every page it applies to. Both turn a stored value into a request,
   * so both ask THIS list rather than each keeping its own — a policy answered
   * differently by two surfaces is not a policy.
   *
   * The shape is deliberately Next.js's, because a Nextly app already declares
   * the same thing in `next.config` for `next/image`, and copying the entry
   * across should just work.
   *
   * **Enforcement is per-renderer, and this is the part to read twice.** The
   * boundary cannot apply this on a block's behalf: it sees the element a block
   * RETURNED, not the URLs the block chose, and an `<img src>` deep inside
   * returned markup is indistinguishable to it from any other prop. The blocks
   * shipped here consult it; a block written outside this package is bounded by
   * it only if it asks. A site that wants a hard limit should pair this with a
   * content security policy, which the browser enforces whatever a block does.
   *
   * Absent means unasked rather than allowed-nothing: a host that configures no
   * list gets exactly the behaviour it had before this existed.
   */
  remotePatterns?: readonly RemotePatternInput[];
}

/**
 * An icon a host resolved: what it is now and the SVG it draws.
 *
 * @experimental
 */
export interface ResolvedIcon {
  /** The id it resolved as, which names the current icon after a rename. */
  readonly id: string;
  /** Its name within the set (`star`), for an accessible name when none is given. */
  readonly name: string;
  /** The SVG's inner markup, trusted: it comes from the host's own set. */
  readonly body: string;
  readonly viewBox: string;
  /**
   * Drawn by its stroke in the text colour (`stroke="currentColor"`), as
   * Lucide's are, rather than by its fill.
   */
  readonly stroked: boolean;
}

/**
 * The context every block render receives.
 *
 * Resolver functions rather than raw maps: a host that resolves media through a
 * CDN, a signed URL, or a local folder differs only in the function it passes,
 * and none of that reaches a block author.
 */
export interface PageContext {
  /**
   * The entry the page renders, when there is one. `null` in standalone use,
   * where a document is rendered with no surrounding record.
   */
  entry: Record<string, unknown> | null;
  /**
   * The collection {@link entry} is an entry of, so a list of the entry's
   * related entries can read the relation as the public reads the entry,
   * through {@link data}, rather than take it from `entry`, which a route may
   * have read with more access than a visitor has. Absent for a Single's page
   * and in standalone use; such a list then shows its empty state.
   *
   * @experimental
   */
  entryCollection?: string;
  /** The locale being rendered, when the host is localized. */
  locale?: string;
  /**
   * True when the entry being rendered is an unpublished working draft rather
   * than its live content. Surfaced so a host can show a preview banner; the
   * renderer itself does not change behaviour on it.
   */
  isWorkingDraft?: boolean;
  /**
   * Data access for dynamic blocks.
   *
   * Optional, because a host is not obliged to answer queries and a block that
   * reads data has to cope with one that does not: the editor draws a block
   * before a source is chosen, and a standalone render may have nothing behind
   * it. `createStandaloneContext` supplies an empty provider, so the ordinary
   * path never sees this absent.
   */
  data?: BlocksDataProvider;
  /**
   * Resolve a media id, or `null` when it cannot be resolved.
   *
   * Async because a real host cannot answer synchronously: a CMS-backed
   * context reads the media record from its database, and a storage adapter
   * that issues signed URLs performs network work to produce one. A
   * synchronous signature would force every such host to pre-resolve every
   * media id on every render, or to lie.
   */
  resolveMedia(id: string, claim?: ReadClaim): Promise<ResolvedMedia | null>;
  /**
   * Resolve an icon id (`lucide:star`) to the SVG it draws, or `null` when
   * this host does not draw that icon.
   *
   * Async, so a set too large to load on every render is loaded only when a
   * page draws one of its icons. Optional, so a host that draws no icons is
   * not made to answer: a block asking an absent resolver draws nothing. A
   * published page is given the Lucide set by its route; a standalone render
   * passes `resolveLucideIcon` from `@nextlyhq/blocks-react/icons/lucide`.
   *
   * @experimental
   */
  resolveIcon?: (id: string) => Promise<ResolvedIcon | null>;
  /**
   * Resolve an entry reference to a path, or `null` when it has none.
   *
   * Async for the same reason: the path depends on the referenced entry's slug
   * and status, which is a read.
   */
  resolveEntryPath(
    collection: string,
    id: string,
    claim?: ReadClaim
  ): Promise<string | null>;
  /**
   * What a collection list reads ahead for the entries it draws. Absent, each
   * entry's reads are made as it is drawn.
   *
   * @experimental
   */
  listReads?: ListBatchReads;
  /**
   * The related entries a list read ahead for the item being drawn, by the
   * relation field it followed: what an item binding through that relation
   * (`author.name`) reads, while the item keeps the id it stores, which a
   * binding to the field itself (`author`) reads. Absent, both read the
   * item's own values.
   *
   * @experimental
   */
  itemFollowed?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /**
   * The blocks the route kept because their conditions held for the page's
   * entry, by id: what a list asks the renderer's own condition gate with,
   * so it reads ahead for exactly the blocks each entry draws.
   *
   * @experimental
   */
  heldConditions?: ReadonlySet<string>;
  /**
   * The binding pass the renderer fills list items' bindings with: what a
   * list reads ahead by, so it reads for the props each entry is drawn with,
   * fallbacks included. Absent, no item binding is filled.
   *
   * @experimental
   */
  itemBindingRun?: BindingRun;
  /**
   * The entry the surrounding repeater is currently on.
   *
   * Distinct from `entry`, which is the record the PAGE renders: a loop over
   * posts sets this per iteration while `entry` stays the page itself, so a
   * block inside the loop can read the post without losing the page.
   *
   * It lives on the context rather than being passed as a prop because a
   * repeater does not know, and should not know, which of its descendants
   * cares. The value flows down to all of them and each takes what it needs.
   *
   * Absent outside a repeater.
   */
  item?: Record<string, unknown>;
  /**
   * The collection {@link item} comes from, set by the repeater beside it, so
   * a binding to the item is checked against that collection's fields.
   *
   * Absent outside a repeater, and in a repeater whose items have no
   * collection; their bindings are then judged by the values' own shapes.
   */
  itemSource?: string;
  /**
   * The named query {@link item} is a row of, set by a list whose source is
   * one, so a binding to an item of a query with its own field schema is
   * checked against the fields it declares, and a related list inside it is
   * told it has no entry to read a relation of.
   *
   * @experimental
   */
  itemQuery?: string;
  /**
   * How a list whose source is a named query runs it. Absent, such a list
   * draws its template once.
   *
   * @experimental
   */
  namedQueries?: NamedQueryHost;
  /**
   * What is left of this render's query allowance.
   *
   * Absent means nothing is counting, which is the editor drawing one block in
   * isolation. A block that reads data should claim before it reads and render
   * nothing when refused, so a page that outruns its budget degrades instead of
   * hanging.
   */
  queries?: QueryBudget;
  /**
   * Whether an author is looking: the editor's canvas, or a preview of a
   * working draft. A block may then draw what it could not do as stored,
   * such as a list whose read failed or whose sort fell back to id order,
   * with a note only that author sees. Absent on a published page, which
   * shows visitors only what they may see.
   *
   * @experimental
   */
  diagnostics?: boolean;
  /**
   * The site's IANA time zone, in which a list's date filter compares whole
   * days for a field holding an instant. UTC when absent.
   *
   * @experimental
   */
  timeZone?: string;
  /**
   * The fields of the collections the page's lists read, as the public sees
   * them, so a list's date filter can tell a field holding a calendar day
   * (compared as that day) from one holding an instant (compared in
   * {@link timeZone}). Absent, every date compares as an instant.
   *
   * @experimental
   */
  fieldShapes?: BlocksFieldShapes;
  /**
   * The collection lists, by node id, an author has asked to see in their
   * empty state: the editor's "Canvas shows: When empty". Such a list draws
   * its empty slot in place of its entries. Honoured only where
   * {@link diagnostics} says an author is looking, so no page a visitor is
   * served can be made to hide its entries.
   *
   * @experimental
   */
  listsShowingEmpty?: ReadonlySet<string>;
  /**
   * The collection lists, by node id, whose author chose a new source that
   * is not written yet, since it waits for an input: the editor's tag for
   * each, which the list wears while it keeps drawing what it stores
   * ("Still showing Events"). Honoured only where {@link diagnostics} says
   * an author is looking.
   *
   * @experimental
   */
  listsStillShowing?: ReadonlyMap<string, string>;
  /**
   * The editor's canvas, which can act on a list note's action: a list whose
   * sort fell back offers "Choose a field" there, which the canvas answers by
   * taking the author to the list's sort. Honoured only where
   * {@link diagnostics} says an author is looking; absent in a preview, which
   * has nothing to act with, so its notes are words alone.
   *
   * @experimental
   */
  listNoteActions?: boolean;
  /**
   * The page of the page's paginated list this render draws, and where each
   * of its pages is served. Given by a route that serves a list's pages at
   * their own addresses; absent, every list shows its first page and draws
   * no links between pages.
   *
   * Read by the one list it names, so a second list split into pages, which
   * validation refuses, never pages the same address twice.
   *
   * @experimental Settles with list pagination.
   */
  listPage?: ListPageContext;
  /**
   * How the sections of the accordion being rendered draw their titles: as
   * text, or as the heading level the accordion names.
   *
   * Widened deliberately, as the one setting a section takes from its group
   * rather than from its own props: a heading level is a fact about the set
   * (every question in an FAQ sits at one level under the page's headings),
   * so the accordion sets it once and its sections read it. An accordion
   * sets it for its own subtree, so one nested inside a section sets its own.
   *
   * Absent outside an accordion, where a section draws its title as text.
   *
   * @experimental
   */
  accordionTitles?: AccordionTitleLevel;
}

/**
 * What an accordion's section titles are drawn as: text, or a heading from
 * level 2 to 6. Not level 1, which names the page itself.
 *
 * @experimental
 */
export type AccordionTitleLevel = "text" | "h2" | "h3" | "h4" | "h5" | "h6";

/**
 * What one of this package's blocks receives.
 *
 * The engine declares `BlockRenderArgs<P, C>` with `renderSlot` returning
 * `BlockRenderResult`, which is `unknown`: the engine is runtime-free, so it
 * cannot name a React type without acquiring React. Naming it is the React
 * renderer's job, and this module already exists to do exactly that for `ctx`.
 *
 * `ReactNode` rather than `ReactNode | Promise<ReactNode>`, which is what
 * `render` may RETURN, and the asymmetry is deliberate. This value is one a
 * block places into its own JSX, and that union is not a legal child: React
 * admits only `Promise<AwaitedReactNode>` — a promise of a settled node — so a
 * promise that may itself yield a promise is refused. Widening here would move
 * the error onto every block that draws a slot.
 */
export interface BlockRenderArgs<P>
  extends Omit<EngineBlockRenderArgs<P, PageContext>, "renderSlot"> {
  renderSlot(this: void, name: string, ctx?: PageContext): ReactNode;
  /**
   * Site-operator decisions this block enforces. See {@link BlockHostPolicy}.
   *
   * Absent means the host configured nothing, and every policy then takes its
   * closed default — the only safe reading of a value that did not arrive.
   *
   * An argument rather than a field on `ctx`, so that the host's own context
   * object is never copied and a block cannot reach the policy through a
   * context it built itself.
   */
  hostPolicy?: BlockHostPolicy;
  /**
   * The site's spacing model, for a block whose markup differs by it. Absent
   * is the engine's default, `gaps`. An argument for the reason `hostPolicy`
   * is one.
   */
  spacingMode?: SpacingMode;
}

/**
 * The site settings a page may bind, under the names the settings use, each
 * `null` while the site has not set it.
 *
 * Only these: the settings also hold values no visitor may see, such as the
 * administrator's address, so a page is handed this allowlist and nothing
 * else. The shape of what `nextly/runtime` reads for a page, written out here
 * because this entry must not import `nextly`.
 *
 * @experimental
 */
export interface BlocksSiteSettings {
  readonly applicationName: string | null;
  readonly siteUrl: string | null;
  readonly logoUrl: string | null;
  /** An IANA time zone such as `Europe/Paris`. */
  readonly timezone: string | null;
}

/**
 * Whose field shapes: a collection's entries, or one Single.
 *
 * @experimental
 */
export type BlocksFieldShapeRef =
  | { readonly collection: string }
  | { readonly single: string };

/**
 * The fields a page's bindings are checked against, as the public sees them.
 *
 * `undefined` for a source whose shapes are not known; its bindings are then
 * judged by the values they read.
 *
 * @experimental
 */
export interface BlocksFieldShapes {
  fieldsOf(ref: BlocksFieldShapeRef): readonly BindingFieldShape[] | undefined;
}

/**
 * What a page's bindings read, already read, and how their values are shown.
 *
 * On a published page every source here is the PUBLIC's: the entry re-read as
 * an anonymous visitor reads it, the Singles and site settings likewise. On
 * the editor's canvas the entry and the Singles are the person editing's,
 * read with their own access (`readBindingSources` over an editor's reader),
 * while the site settings and the field shapes stay the public's. The
 * renderer takes values only from here, never from the context's `entry`,
 * which a route may have read with more access than a visitor has. A source
 * left out is one this page did not read: its bindings render their
 * fallbacks and are reported.
 *
 * @experimental
 */
export interface PageBindings {
  /** The entry the page shows, as the public reads it; `null` when it may see none. */
  readonly entry?: Readonly<Record<string, unknown>> | null;
  /** Where the entry's field shapes are found. */
  readonly entryRef?: BlocksFieldShapeRef;
  /** Each Single the page binds, by slug; `null` for one the public may not see. */
  readonly singles?: ReadonlyMap<
    string,
    Readonly<Record<string, unknown>> | null
  >;
  /** The site settings a page may show; `null` when there are none. */
  readonly site?: BlocksSiteSettings | null;
  readonly fieldShapes?: BlocksFieldShapes;
  /**
   * The time zone a date-time is shown in. UTC when absent, and when it is
   * not a zone the runtime knows. A calendar date is always shown as its own
   * day, whatever the zone.
   */
  readonly timeZone?: string;
  /**
   * The collection whose ids `resolveMedia` reads, so an image is filled only
   * from an upload field pointing there. `media`, Nextly's media library,
   * when absent: a host resolving media from a collection of its own names
   * it here.
   */
  readonly mediaCollection?: string;
}

/**
 * Told about the bindings a render could not use as stored.
 *
 * Called once with what the page's own pass found, and again for each new
 * problem a list item's binding meets while the list draws. Nothing is
 * written during a render; a route logs these, an editor shows them.
 *
 * @experimental
 */
export type BindingIssuesHandler = (issues: readonly PageIssue[]) => void;

/**
 * Something a render could not use as stored: a binding, or a block's
 * visibility conditions (`kind: "condition"`), which travel one channel so a
 * route logs, and an editor shows, both alike.
 *
 * @experimental
 */
export type PageIssue = BindingIssue | ConditionIssue;

/**
 * Whether a page issue is a binding's, for a handler that reads only those.
 *
 * @experimental
 */
export function isBindingIssue(issue: PageIssue): issue is BindingIssue {
  return !("kind" in issue && issue.kind === "condition");
}

/**
 * Reads one page render may perform when the route was given no number.
 *
 * Generous for a page and small against a database: a document would have to
 * nest loops to approach it, which is the shape the budget exists to bound. A
 * page that exceeds it renders what it could reach rather than failing, so the
 * cost of the default being low is visible content, while the cost of having no
 * default at all is an unbounded read amplification reachable by URL.
 *
 * @experimental
 */
export const DEFAULT_MAX_QUERIES = 500;

/**
 * A budget for ONE page render: `max` reads, then none.
 *
 * Here rather than beside the route, so every surface that draws a page
 * bounds its reads the same way: the published route and the editor's
 * canvas alike.
 *
 * Created per render rather than per route: the counter is spent, so a single
 * budget shared across requests would exhaust on the first few pages and serve
 * every later request truncated — a fault that grows with uptime and disappears
 * on restart, which is the hardest kind to attribute.
 */
export function createQueryBudget(
  max: number = DEFAULT_MAX_QUERIES,
  options: QueryBudgetOptions = {}
): QueryBudget & { remaining(): number; report(): PageReadReport } {
  // `NaN` is what `Number(process.env.MAX_QUERIES)` produces for an unset or
  // malformed variable, and every comparison against it is false — so
  // `remaining <= 0` never fires and the budget silently becomes unlimited.
  // That is the failure this exists to prevent, reached by a configuration
  // mistake rather than by a document.
  // A count of reads is a whole number, not below zero, so `take`,
  // `remaining` and `report` agree on what a fractional or negative cap
  // allows: 2.7 allows 2, and -1 none. Unlimited stays unlimited.
  const cap = Number.isNaN(max)
    ? DEFAULT_MAX_QUERIES
    : max === Infinity
      ? Infinity
      : Math.max(0, Math.floor(max));
  let remaining = cap;
  // What was counted, for the editor's meter and the overrun warning. The
  // count is the sum of the kinds, every granted claim adding to one, so the
  // total and its breakdown cannot disagree.
  let refused = 0;
  const byKind: Partial<Record<ReadKind, number>> = {};
  const unread = new Map<string, UnreadBlock>();
  return {
    remaining: () => Math.max(0, remaining),
    take: (claim: ReadClaim = {}) => {
      const kind = claim.kind ?? "page";
      if (remaining <= 0) {
        refused += 1;
        noteUnread(unread, claim.nodeId, kind);
        for (const nodeId of claim.nodeIds ?? []) {
          noteUnread(unread, nodeId, kind);
        }
        options.onRefused?.(claim);
        return false;
      }
      remaining -= 1;
      byKind[kind] = (byKind[kind] ?? 0) + 1;
      return true;
    },
    report: () => ({
      cap,
      used: sumOf(byKind),
      refused,
      byKind: { ...byKind },
      unread: [...unread.values()],
    }),
  };
}

/** A refused block, kept once per block and kind, in the order it asked. */
function noteUnread(
  unread: Map<string, UnreadBlock>,
  nodeId: string | undefined,
  what: ReadKind
): void {
  if (nodeId === undefined) return;
  const key = `${nodeId}\u0000${what}`;
  if (!unread.has(key)) unread.set(key, { nodeId, what });
}

/** Options for {@link createQueryBudget}. */
export interface QueryBudgetOptions {
  /**
   * Told of each claim refused, as it is refused: what a route logs the
   * overrun from.
   */
  readonly onRefused?: (claim: ReadClaim) => void;
}

/** The reads counted, by kind, added up. */
function sumOf(byKind: Partial<Record<ReadKind, number>>): number {
  return Object.values(byKind).reduce((total, count) => total + count, 0);
}

/**
 * Which page of its list a render draws, and the address of each.
 *
 * @experimental Settles with list pagination.
 */
export interface ListPageContext {
  /** The list whose pages these are: the node's id. */
  readonly nodeId: string;
  /** The page drawn, from 1. */
  readonly page: number;
  /**
   * The address of page `page` of the list, for its links: the page's own
   * address for page 1.
   */
  readonly href: (page: number) => string;
  /**
   * True where the page already claimed the list's first read from its
   * allowance (`queries`), in the order the route counted its pages in, so
   * the list reads without claiming again.
   */
  readonly claimed?: boolean;
  /**
   * How many pages the list has, where the route counted them to serve this
   * page; absent, the list counts its pages from its own read.
   */
  readonly pages?: number;
}

/** A context with nothing wired up: the standalone default. */
export function createStandaloneContext(
  overrides: Partial<PageContext> = {}
): PageContext {
  const defaults: PageContext = {
    entry: null,
    data: emptyDataProvider,
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
  };

  // Spreading `overrides` wholesale would let an explicit `undefined` replace a
  // default: `exactOptionalPropertyTypes` is off, so
  // `createStandaloneContext({ data: maybeProvider })` typechecks and then
  // produces a context whose `data` is undefined, which crashes at the first
  // dynamic block instead of falling back. Only defined values win.
  const defined = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined)
  ) as Partial<PageContext>;

  return { ...defaults, ...defined };
}

/**
 * A block definition written against THIS renderer.
 *
 * The engine's `defineBlock` leaves the context unnamed and types `renderSlot`
 * as returning `BlockRenderResult`, which is `unknown`: the engine carries no
 * React types. That is correct for the engine and wrong for an author, who then
 * cannot place a slot's output into their own JSX without annotating the
 * argument by hand at every block.
 *
 * Naming both here is the same service `@nextlyhq/plugin-sdk/blocks` performs
 * for plugin authors, offered to anyone rendering with this package directly.
 */
export interface ReactBlockDefinition<P extends object>
  extends Omit<EngineBlockDefinition<P, PageContext>, "render"> {
  /**
   * `ReactNode | Promise<ReactNode>` rather than the engine's
   * `BlockRenderResult`, which is `unknown`.
   *
   * `unknown` is right for the engine, which carries no React types, and wrong
   * for an authoring helper: it accepts `render: () => ({ not: "a node" })`,
   * which typechecks and then renders an `invalid-output` placeholder. A helper
   * whose types admit what the renderer will refuse has moved a compile-time
   * error to runtime.
   *
   * The promise is allowed because a block may be an async Server Component;
   * the renderer awaits it under the same containment as a synchronous one.
   */
  render(args: BlockRenderArgs<P>): ReactNode | Promise<ReactNode>;
}

/**
 * Declare a block for this renderer.
 *
 * Identity at runtime, exactly like the engine's: the value is the definition.
 * What it adds is the typing above, so a block's `render` receives a context
 * this package has named and a `renderSlot` that returns something React can
 * render.
 */
export function defineBlock<P extends object>(
  definition: ReactBlockDefinition<P>
): ReactBlockDefinition<P> {
  return definition;
}
