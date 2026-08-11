import type {
  BlockRenderArgs as EngineBlockRenderArgs,
  BlockDefinition as EngineBlockDefinition,
  RemotePatternInput,
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

/** A query the renderer asks its host to answer. Shapes stay deliberately
 * narrow: this is the subset dynamic blocks need today, and widening it is a
 * deliberate act rather than a side effect of a new block. */
export interface BlocksQuery {
  collection: string;
  limit?: number;
  offset?: number;
  sort?: string;
  locale?: string;
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
  /** Claim one read. False when the page has spent its allowance. */
  take(): boolean;
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
  resolveMedia(id: string): Promise<ResolvedMedia | null>;
  /**
   * Resolve an entry reference to a path, or `null` when it has none.
   *
   * Async for the same reason: the path depends on the referenced entry's slug
   * and status, which is a read.
   */
  resolveEntryPath(collection: string, id: string): Promise<string | null>;
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
   * What is left of this render's query allowance.
   *
   * Absent means nothing is counting, which is the editor drawing one block in
   * isolation. A block that reads data should claim before it reads and render
   * nothing when refused, so a page that outruns its budget degrades instead of
   * hanging.
   */
  queries?: QueryBudget;
}

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
 * block places into its own JSX, and that union is not a legal child under
 * either supported peer: React 18 admits no promise at all, and React 19 admits
 * only `Promise<AwaitedReactNode>` — a promise of a settled node — so a promise
 * that may itself yield a promise is refused there too. Widening here would
 * move the error onto every block that draws a slot.
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
