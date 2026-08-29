/**
 * `resolveContent` — resolve a URL slug to a single content entry, publish-state
 * and access enforced, cached with F1 so the page and its metadata share one
 * read and go stale in lockstep on a content write.
 *
 * A genuine miss (or an access-denied entry) returns `null` (the caller renders
 * `notFound()`), while a transient read error is RETHROWN rather than swallowed
 * to `null` — so a DB blip becomes a retryable error instead of a
 * permanently-cached 404 (the exact lesson from the F1 blog-template review).
 *
 * @module runtime/routing/resolve-content
 */
import { getNextly } from "../../direct-api/nextly";
import type { Nextly } from "../../direct-api/nextly";
import type { UserContext } from "../../direct-api/types/shared";
import { NextlyError } from "../../errors/nextly-error";
import { TRUSTS_EVERY_COLLECTION } from "../../services/collections/trust-grant";
import { cachedFind } from "../cache/cached-find";
import { nextlyTags } from "../cache/nextly-tags";
import { releaseBoundedRevalidate } from "../cache/release-cache-window";

import { markDynamic } from "./mark-dynamic";

/** A resolved content entry (loose by design — shape is the app's collection). */
export type ContentEntry = Record<string, unknown>;

/**
 * The booted-Nextly surface these helpers need: a `find` reader, plus
 * `findByID` for the working-draft overlay. Typed structurally (not as the
 * Direct API class) so BOTH the internal singleton and the public instance
 * returned by `await getNextly(config)` satisfy it — the public interface does
 * not expose the Direct API's internal handlers.
 */
export type NextlyContentReader = Pick<Nextly, "find" | "findByID">;

/** Options for {@link resolveContent}. */
interface ResolveContentOptionsBase {
  /**
   * A booted Nextly instance. Defaults to the runtime singleton (`getNextly()`),
   * which requires services to be registered — pass one explicitly (e.g. the
   * value from `await getNextly(config)`) from a frontend read path that boots
   * the config itself.
   */
  nextly?: NextlyContentReader;
  /** The field holding the URL slug (default `"slug"`). */
  slugField?: string;
  /**
   * Draft/Published lifecycle scope (default `"published"`). This is
   * lifecycle-aware AND locale-aware: for a localized collection it also
   * constrains the per-locale companion `_status`, so a draft translation under
   * a published main row is not returned. On a status-less collection (no
   * built-in lifecycle) it is a no-op — every row is live.
   */
  status?: "published" | "draft" | "all";
  /**
   * Return the pending working draft in place of the live row when one exists.
   *
   * The shipped draft model is TWO layers and a preview has to honour both.
   * `status` covers an entry that has never been published; this covers pending
   * edits on an ALREADY-published entry, which live in a sidecar row and are
   * invisible to any `status` scope. Widening `status` alone therefore shows a
   * published page's LIVE content while the edits being previewed stay hidden —
   * the failure this option exists to prevent.
   *
   * Because the two belong together, `status` defaults to `"all"` when this is
   * set on a TRUSTED read (`overrideAccess: true`), so the common case cannot
   * be half-configured. An explicit `status` still wins. The widening is
   * deliberately limited to trusted reads: the overlay is gated per row by an
   * update-capability probe, but widening `status` is not gated by anything, so
   * on an enforced read it would expose every never-published entry to whoever
   * asked. An enforced draft read therefore stays published-only, and sees
   * pending edits only through the (gated) overlay.
   *
   * Effective only on a drafts-enabled, non-localized collection with the
   * `status` lifecycle, and gated by an update-capability probe: a caller who
   * cannot edit the document still gets the published row. A read that is
   * neither trusted (`overrideAccess: true`) nor carrying a `user` can never
   * pass that probe, so a draft read must be one or the other.
   *
   * A draft read is NEVER cached — see the caching note below.
   *
   * @default false
   */
  draft?: boolean;
  /**
   * The entry a preview grant NAMES, resolved by id instead of by slug.
   *
   * Only meaningful alongside `draft` on a trusted read. A slug is not unique:
   * the ordinary lookup settles duplicates by sorting on `id`, so a grant for
   * one entry can land on another that happens to share its slug, and the
   * caller then rejects the mismatch and falls back to published. The editor
   * sees LIVE content at a link they were given for a draft.
   *
   * Reading by the id the grant names removes that comparison rather than
   * hardening it. The resolved entry's own slug is then confirmed against the
   * requested one, which is what stops a preview session turning every path on
   * the site into the previewed entry: without that check a cookie for one page
   * would render that page at every URL for the life of the session.
   *
   * A grant that names a deleted entry, or one whose slug no longer matches the
   * path, falls through to the ordinary slug resolution rather than failing. A
   * preview link outlives what it points at.
   */
  entryId?: string;
  /** Relation population depth for rendering (default `1`). */
  depth?: number;
  /** Read a specific locale (localized collections). */
  locale?: string;
  /** Rich-text output format for rich-text fields (default the reader's). */
  richTextFormat?: "json" | "html" | "both";
  /**
   * Extra cache tags merged with the collection's own tag. Add related
   * collections' tags (e.g. `nextlyTags("authors")`) when a `depth > 0` read
   * populates relations, so a write to one of those busts this read too.
   */
  tags?: string[];
  /**
   * Time-based revalidation in seconds for a CACHED (trusted) read — a safety
   * net on top of tag-based busting. `false` (default) means tag-only; a
   * non-positive value is treated as `false`. Ignored for enforced or
   * user-scoped reads, which are never cached.
   */
  revalidate?: number | false;
  /**
   * A stable discriminator folded into the cache key. Supply a unique value when
   * distinct `nextly` readers (e.g. per-tenant or per-database) can resolve the
   * same collection + slug, so their cached reads never alias each other.
   */
  cacheScope?: string;
  /**
   * Whether to bypass the collection's read-access rules. Defaults to `false`,
   * so a content route enforces STORED access policies: a rule-less (public)
   * collection still renders, but one with a stored member-only/role-based read
   * rule is hidden from an unauthenticated request (resolves to `null` →
   * `notFound()`). Pass `true` for a fully trusted read. NOTE on anonymous
   * scope: an anonymous read enforces stored rules that DENY outright
   * (public/authenticated/role-based). A row-level CONSTRAINT rule (owner-only,
   * or a custom rule returning a query predicate) and inline
   * `defineCollection({ access })` code rules require a `user` context to
   * evaluate, so they are not applied for an anonymous read — gate such content
   * behind an authenticated read (pass a `user`) rather than relying on the
   * anonymous default. CACHING: only a trusted (`overrideAccess: true`) read
   * with no `user` is F1-cached — an enforced read is never cached (its access
   * decision can't be invalidated on a policy change). A public site that wants
   * cached pages should read its public content with `overrideAccess: true`.
   */
  overrideAccess?: boolean;
  /**
   * Which collections that trust may reach as relationships are expanded.
   *
   * A route lists the collections it SERVES; a page populating a relationship
   * reaches one it did not list. Without this, every populated target inherits
   * the route's bypass. Named collections are read trusted; the rest are read
   * as a visitor would read them.
   *
   * Only ever narrows, and never admits a target's drafts — see
   * `ContentRouteConfig.trustedCollections`.
   *
   * **A list rather than the predicate the read layer takes, because this
   * layer CACHES.** Two routes differing only in what they trust produce
   * different rows, so the bound has to be part of the cache identity — and a
   * function has none. Taking the data means the key and the predicate are
   * derived from one value that cannot disagree with itself; taking a
   * predicate plus a separate key would be two options a caller can get out of
   * step.
   */
  trustedCollections?: readonly string[] | typeof TRUSTS_EVERY_COLLECTION;
  /**
   * What the CALLER authorized, before a draft decision widened it.
   *
   * A route forces `overrideAccess` on so a granted entry can be reached at
   * all. That forcing is justified only while the grant is answering the path,
   * so a read that runs after it stops answering uses this instead. Defaults to
   * `overrideAccess`, leaving a caller that widened nothing where it was.
   */
  callerOverrideAccess?: boolean;
  /** User identity to evaluate access rules against (with `overrideAccess: false`). */
  user?: UserContext;
  /**
   * Whose field-level read rules the DRAFT read is judged by.
   *
   * A draft read is trusted — that is what lets it reach a never-published row
   * at all — and trust switched off field rules along with row ones, because
   * one flag decided both. So the document came back carrying every field,
   * including any the person who granted the draft could not read themselves:
   * a shareable link was a way to read past your own permissions by sending one
   * to yourself.
   *
   * Naming the identity here keeps the row bypass and gives back only the field
   * half, evaluated inside the read as this user — so the rules run in the
   * pipeline's own before-and-after-hooks sandwich rather than over the
   * finished document, where an `afterRead` hook could have already copied a
   * denied field onto an allowed one.
   *
   * **Scoped to the draft read alone, and that is the load-bearing part.** When
   * a named grant stops answering this path the request falls through to
   * `publishedOnly`, which is an ordinary anonymous read of a published row —
   * carrying this identity into it would judge public content by a stranger's
   * rules and strip fields every visitor is entitled to.
   *
   * Absent means today's behaviour: a draft read judged by no field rules at
   * all. Only meaningful alongside `draft` and `overrideAccess`.
   */
  draftFieldAccessAs?: UserContext;
}

/**
 * A content read, with its trust answered rather than assumed.
 *
 * A route names ONE collection. The page it renders reaches others through
 * relationships, and those were never named here. Saying nothing meant every
 * populated target inherited the route's bypass — which is how a public route
 * ends up writing another collection's restricted rows into a static artifact,
 * where they outlive the row being unpublished.
 *
 * Expressed as a union so the question is put only to the reads that can answer
 * it wrongly. An enforced read trusts nothing and is not asked; a read holding
 * the bypass does not compile until it says how far that bypass travels. A
 * route that genuinely serves everything says {@link TRUSTS_EVERY_COLLECTION}
 * and performs exactly the read it performed before — the value records that
 * someone decided, which absence could not.
 *
 * The union narrows on a COMPUTED flag too, which is the case that matters:
 * a route writing `overrideAccess: granted || draft` is the shape that shipped
 * unbounded, and TypeScript checks each constituent of `boolean` separately, so
 * that spelling is caught as surely as a literal `true`.
 */
export type ResolveContentOptions = ResolveContentOptionsBase &
  (
    | { overrideAccess?: false }
    | {
        overrideAccess: true;
        trustedCollections: readonly string[] | typeof TRUSTS_EVERY_COLLECTION;
      }
  );

/**
 * Resolve a published entry by slug in `collection`, F1-cached and tagged so a
 * write to the collection busts it.
 *
 * @example
 * ```ts
 * const post = await resolveContent("posts", slug, { depth: 2 });
 * if (!post) notFound();
 * ```
 */
/**
 * Runs the working-draft overlay read, answering `null` when there is no draft
 * to be had rather than failing the page.
 *
 * Scoped to THIS read on purpose. A 404 here means the row went away between
 * the slug lookup and this call, or that an enforced by-id read filtered it to
 * published — both simply mean "no overlay", and the live row already in hand
 * is the honest answer. Wrapping the slug lookup in the same handler would be
 * much worse: a 404 from a mistyped collection, or from schema or hook code
 * beneath it, would render as an ordinary content miss with nothing to say why.
 *
 * Every other failure still propagates, so a database blip stays a retryable
 * error rather than becoming a permanently-cached 404.
 */
async function readOverlay(
  read: () => Promise<ContentEntry | null>
): Promise<ContentEntry | null> {
  try {
    return await read();
  } catch (error) {
    if (NextlyError.is(error) && error.statusCode === 404) return null;
    throw error;
  }
}

export async function resolveContent(
  collection: string,
  slug: string,
  options: ResolveContentOptions = {}
): Promise<ContentEntry | null> {
  const nextly = options.nextly ?? getNextly();
  const slugField = options.slugField ?? "slug";
  const draft = options.draft ?? false;
  const grantedEntryId = options.entryId;
  const depth = options.depth ?? 1;
  const locale = options.locale;
  const overrideAccess = options.overrideAccess ?? false;
  const callerOverrideAccess = options.callerOverrideAccess ?? overrideAccess;
  const user = options.user;
  // Only the trusted draft read carries the sharer's identity. A read that is
  // not trusted already evaluates field rules for whoever `user` is, and the
  // published fall-through below must stay anonymous — see
  // {@link ResolveContentOptions.draftFieldAccessAs}.
  const draftFieldAccessAs =
    draft && overrideAccess ? options.draftFieldAccessAs : undefined;

  // Widening the lifecycle scope follows TRUST, not the draft flag.
  //
  // The two halves of a draft read are gated very differently. The working-draft
  // overlay is judged per row, by an update-capability probe, so asking for it
  // is safe from anywhere. Widening `status` is not judged at all — the list
  // read simply returns never-published rows — so tying it to `draft` alone
  // would let a preview flag wired from an untrusted request publish
  // unpublished pages.
  //
  // So an untrusted draft read still sees only published rows, and overlays
  // their pending edits. Previewing an entry that has never been published
  // needs `overrideAccess: true`, which is the caller stating they have already
  // authorized it. An explicit `status` still wins either way.
  const status =
    options.status ?? (draft && overrideAccess ? "all" : "published");

  /**
   * One statement of whose field rules a read is judged by.
   *
   * Spread into every read that carries the sharer rather than written out at
   * each of them. Three copies agree on the day they are written; the one that
   * is forgotten afterwards hands back an unredacted document, which is the
   * defect this option exists to close. Resolves to today's behaviour wherever
   * no sharer is named.
   */
  const sharerFieldAccess = {
    // `user` is left as the CALLER — anonymous, on a preview — and the sharer
    // travels beside it as a redaction basis. Putting the sharer into `user`
    // made every collection, stored and field-level hook see them as the
    // requester: a hook branching on `req.user` would add an editor-only value
    // and hand it to whoever holds the link, and a value a hook invents need
    // not correspond to any declared field, so the access pass cannot take it
    // back. The token's own documentation limits `mnt` to a redaction basis;
    // this is that limit made structural.
    user,
    ...(draftFieldAccessAs === undefined
      ? {}
      : { fieldAccessUser: draftFieldAccessAs }),
    enforceFieldAccess: draftFieldAccessAs !== undefined,
  };

  /** Whether a resolved entry is the one this path asked for. */
  const answersThisPath = (entry: ContentEntry): boolean =>
    entry[slugField] === slug;

  /**
   * The same question, asked where the slug may have been REDACTED away.
   *
   * The slug field is an ordinary field and may carry its own read rule. Once
   * the granted read is judged by the sharer, a rule that denies them removes
   * the slug from the document — and deciding the path from a value that was
   * withheld rather than absent answers 404 for a perfectly valid link, or
   * silently serves the published row instead of the draft.
   *
   * So an absent slug is resolved separately: one trusted read of that column,
   * by the id the token names, on the same draft view the granted read used —
   * a draft that renamed its own slug must compare as the draft, not as the
   * live row. Nothing is disclosed: the value is compared and discarded, and
   * the path it is compared against is the one the bearer supplied.
   *
   * Only on the redacted case, so an ordinary preview pays for no extra query.
   */
  const grantedAnswersThisPath = async (
    entry: ContentEntry,
    id: string
  ): Promise<boolean> => {
    if (entry[slugField] !== undefined) return answersThisPath(entry);

    const row = await readOverlay(() =>
      nextly.findByID({
        collection,
        id,
        draft: true,
        depth: 0,
        overrideAccess: true,
        trusted,
        user: undefined,
        select: { [slugField]: true },
        ...(locale ? { locale } : {}),
      })
    );
    return row !== null && row[slugField] === slug;
  };

  /**
   * Resolve this path with no draft authorization at all.
   *
   * Used when a named grant did not answer this path. Reading with the widened
   * scope would surface a never-published row the grant never named, which is
   * exactly the disclosure the grant is supposed to bound.
   *
   * Trust is withdrawn in BOTH dimensions, not just the lifecycle one. The
   * access widening exists to reach the entry a grant NAMES; once the grant is
   * not answering this path the request is an ordinary anonymous one, and
   * carrying the widening here would let one document-scoped grant return any
   * published row in the collection, including rows the collection's own
   * access rules withhold from the caller.
   */
  const publishedOnly = async (): Promise<ContentEntry | null> => {
    const result = await nextly.find({
      collection,
      where: { [slugField]: { equals: slug } },
      // This filter is the route's own address for the page, not a query
      // somebody sent. Without saying so, a site that puts a read rule on its
      // slug field would have every enforced lookup refused by the guard that
      // stops a caller bisecting a hidden value -- and the slug is in the URL
      // of every page this route serves, so addressing by it discloses nothing
      // the routing has not already published.
      frameworkFilter: true,
      status: options.status ?? "published",
      limit: 1,
      sort: "id",
      depth,
      overrideAccess: callerOverrideAccess,
      trusted,
      user,
      ...(options.richTextFormat
        ? { richTextFormat: options.richTextFormat }
        : {}),
      ...(locale ? { locale } : {}),
    });
    return result.items[0] ?? null;
  };

  const read = async (): Promise<ContentEntry | null> => {
    try {
      // A named grant resolves by id FIRST, so a duplicate slug cannot decide
      // which document a preview opens. Trusted-only for the same reason the
      // status widening is: an enforced read could not return an unpublished
      // row anyway, and reading by an id the request supplied is exactly the
      // shape that must not be reachable without the caller having authorized
      // it.
      if (draft && grantedEntryId !== undefined && overrideAccess) {
        const granted = await readOverlay(() =>
          nextly.findByID({
            collection,
            id: grantedEntryId,
            draft: true,
            depth,
            overrideAccess,
            trusted,
            // Keeps the row bypass above and gives back the field half, judged
            // as the sharer.
            ...sharerFieldAccess,
            ...(options.richTextFormat
              ? { richTextFormat: options.richTextFormat }
              : {}),
            ...(locale ? { locale } : {}),
          })
        );
        if (
          granted !== null &&
          (await grantedAnswersThisPath(granted, grantedEntryId))
        ) {
          return granted;
        }
        // Deleted, or living at a different path than the one requested, so
        // this request holds no draft authorization for THIS path. It resolves
        // published-only from here, which is what makes the fall-through safe
        // to take without a second identity check downstream: a named grant
        // authorizes exactly one entry, and the widened lifecycle scope exists
        // solely to reach it.
        return publishedOnly();
      }

      const result = await nextly.find({
        collection,
        where: { [slugField]: { equals: slug } },
        // This filter is the route's own address for the page, not a query
        // somebody sent. Without saying so, a site that puts a read rule on its
        // slug field would have every enforced lookup refused by the guard that
        // stops a caller bisecting a hidden value -- and the slug is in the URL
        // of every page this route serves, so addressing by it discloses nothing
        // the routing has not already published.
        frameworkFilter: true,
        // Lifecycle-aware publish scope — drives the query service's status
        // filter, so it also constrains a localized collection's companion
        // `_status` (a draft translation never leaks). A no-op on status-less
        // collections. The `where` clause no longer carries a status predicate.
        status,
        limit: 1,
        // A slug field is ordinary text and need not be unique; sort by the
        // always-present unique `id` so duplicate-slug rows resolve to the same
        // entry deterministically instead of an arbitrary one.
        sort: "id",
        depth,
        // Enforce the collection's read policy unless the caller opts out.
        overrideAccess,
        trusted,
        // Pass the user explicitly (even `undefined`) so an anonymous read
        // CLEARS any default user configured on the reader instead of merging
        // over it — otherwise a reader booted with a default identity would make
        // this "anonymous" read run as that member.
        // See the by-id read above: a trusted draft keeps its row bypass and
        // hands back the field half to the sharer's own rules. Resolves to
        // today's behaviour on every non-draft read.
        ...sharerFieldAccess,
        ...(options.richTextFormat
          ? { richTextFormat: options.richTextFormat }
          : {}),
        // The content locale drives the localized read + fallback.
        ...(locale ? { locale } : {}),
      });
      const found = result.items[0] ?? null;
      if (found === null || !draft) return found;

      // The overlay lives on the by-id read, not the list read, so a slug
      // lookup cannot surface it directly. Re-reading the resolved row by id is
      // what turns "the live row whose slug matches" into "what an editor is
      // about to publish"; the service still runs its update-capability probe,
      // so this cannot widen who sees a draft.
      //
      // Consequence worth knowing: the lookup matches the LIVE row's slug. A
      // draft that renamed its own slug is previewable at the published URL,
      // not at the new one — resolve by id (the shape a preview link carries)
      // when the new slug is what matters.
      const id = found.id;
      if (typeof id !== "string" && typeof id !== "number") return found;
      // The overlay is an ENHANCEMENT, never a requirement. Deciding whether to
      // attempt it from the row's own `status` was wrong twice over: an
      // `afterRead` hook may reshape or drop that field before it is read here,
      // and an unpublished row would be skipped even where it could be served.
      // So it is always attempted, and anything answering "no draft" falls back
      // to the live row already in hand.
      const overlaid = await readOverlay(() =>
        nextly.findByID({
          collection,
          id: String(id),
          draft: true,
          depth,
          overrideAccess,
          trusted,
          // The overlay REPLACES the row resolved above, so it has to be judged
          // by the same rules. Carrying the plain `user` here handed back the
          // fully trusted draft and undid the enforcement one line earlier.
          ...sharerFieldAccess,
          ...(options.richTextFormat
            ? { richTextFormat: options.richTextFormat }
            : {}),
          ...(locale ? { locale } : {}),
        })
      );
      return overlaid ?? found;
    } catch (error) {
      // An access denial (403) means the read policy hides this entry from the
      // caller — treat it as absent (→ notFound), never as a transient error.
      // Any other error still rethrows (retryable, not a permanently-cached 404).
      // `NextlyError.is` matches across bundled package copies where a plain
      // `instanceof` would miss a differently-realmed error class.
      if (NextlyError.is(error) && error.statusCode === 403) {
        return null;
      }
      throw error;
    }
  };

  // ONLY a trusted, userless read is cached. An enforced read's result depends
  // on an access decision that a content-tag bust can't invalidate — a stored
  // read-policy change (public → restricted) doesn't write an entry, so a cached
  // enforced result would keep serving to unauthorized visitors. And any read
  // carrying a user can produce user-dependent output via `afterRead` hooks.
  // So caching requires `overrideAccess: true` AND no user; every enforced or
  // user-scoped read runs fresh per request. A public site that wants cached
  // pages reads its public content trusted (`overrideAccess: true`).
  //
  // A DRAFT read is never cached either, and for a reason the key could not fix
  // by being more specific: a working draft changes on every save while cache
  // tags are busted by writes to the LIVE row, so a cached draft would show an
  // editor their previous save and call it a preview. Serving it stale is the
  // one thing a preview must not do, and per-request freshness is exactly what
  // a preview wants. It also removes any path by which a draft entry could be
  // handed to a request that never asked for one.
  // Sorted and de-duplicated so the same set written two ways is one cache
  // identity, and so the predicate and the key are built from one value.
  // Both spellings of "reaches everything" collapse here, and must: an absent
  // bound and `TRUSTS_EVERY_COLLECTION` describe the same read, so they have to
  // produce the same predicate AND the same cache identity. Giving the constant
  // a key of its own would split one read across two entries that can then
  // diverge under revalidation while claiming to be the same page.
  const named =
    options.trustedCollections === undefined ||
    options.trustedCollections === TRUSTS_EVERY_COLLECTION
      ? undefined
      : options.trustedCollections;
  const trustedNames =
    named === undefined ? undefined : [...new Set(named)].sort();
  const trusted =
    trustedNames === undefined
      ? undefined
      : (name: string): boolean => trustedNames.includes(name);

  // A bounded read stays cacheable. Its refused targets are judged by stored
  // policies and a policy change writes no row, so no content tag busts and an
  // entry can outlive a tightening — but that staleness is not something the
  // bound introduces. A pre-rendered page is a point-in-time copy of everything
  // it read, and a policy tightening after the build leaves the whole page
  // stale, bounded targets or not. The remedy is revalidation: the `tags`
  // option names the related collections a populated read depends on.
  //
  // Per-request rendering is not available as an alternative here anyway. The
  // only escape from caching in this module is `markDynamic()`, and the one
  // factory that reaches this path, `createPublicContentRoute`, exports
  // `generateStaticParams` — so marking its render dynamic would contradict
  // what the route has already told Next, exactly as `draft` would.
  const cacheable = overrideAccess && !user && !draft;
  if (!cacheable) {
    // Bypassing `unstable_cache` alone does not opt out of Next's Full Route
    // Cache, so a page rendered while a policy was public could stay statically
    // cached after it tightens. Mark the render dynamic so an enforced read
    // genuinely runs fresh per request.
    markDynamic();
    return read();
  }

  // How long this read may live, bounded by the next scheduled release.
  // Shared with the Single route, and resolving the adapter from the container
  // rather than off the reader — see `release-cache-window`.
  const cacheSeconds = await releaseBoundedRevalidate(options.revalidate);

  return cachedFind(read, {
    // Tag by the collection so any write to it makes this read fresh, plus any
    // caller-supplied tags (related collections a populated read depends on).
    tags: [...nextlyTags(collection), ...(options.tags ?? [])],
    keyParts: [
      "nextly",
      "resolve-content",
      // A caller-supplied scope so distinct readers (per-tenant/per-database)
      // resolving the same collection + slug never share a cache entry.
      options.cacheScope ?? "",
      collection,
      slugField,
      slug,
      locale ?? "",
      // The key varies by every dimension that changes the read result.
      status,
      String(depth),
      // When omitted, the read inherits the reader's default format (which may
      // not be "json"), so key it as "inherit" — never as a concrete format — so
      // an explicit-format call can't reuse an inherited-shape cache entry.
      options.richTextFormat ?? "inherit",
      // The bound changes which related rows come back, so two routes that
      // differ only in what they trust must not share an entry.
      //
      // JSON rather than a join, because the encoding has to be INJECTIVE over
      // an unvalidated string array: `["a", "b"]` and `["a,b"]` join to the
      // same text while trusting different sets, and any sentinel string is a
      // legal collection slug that a one-element array could collide with.
      // `JSON.stringify` distinguishes all three — `null` for an unbounded read
      // cannot be produced by any array.
      JSON.stringify(trustedNames ?? null),
    ],
    // Trusted reads don't depend on an access decision, so tag-only busting is
    // safe; an explicit positive `revalidate` adds a time-based safety net, and
    // a non-positive value degrades to tag-only (`unstable_cache` rejects `0`).
    revalidate: cacheSeconds,
  });
}
