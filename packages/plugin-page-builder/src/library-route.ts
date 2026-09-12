import { measureBytes } from "@nextlyhq/blocks-engine";
import { COMPONENT_DOCUMENT_FIELD } from "@nextlyhq/blocks-react";
import {
  NextlyError,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { requireNextly } from "nextly/runtime";
/**
 * The two reads the editor makes to find out what it may offer and draw: the
 * pattern library for the insert panel, and the component definitions for the
 * canvas, the panel and the inspector.
 *
 * ## Why a route rather than the collection API
 *
 * The panel needs one index, and the index has two sources: rows in the
 * `patterns` collection, and patterns a plugin DECLARES in code. Only a server
 * can see both, so the merge has to happen here — and doing it in one place is
 * what keeps the panel from growing a second notion of what a pattern is.
 *
 * Measured, there is also nothing else available: the admin's own collection
 * hooks are not exported from `@nextlyhq/plugin-sdk/admin`, which is the only
 * surface this package may import from, so a browser-side read of the
 * collection is not merely worse here — it does not exist.
 *
 * ## Two routes, one walk
 *
 * A route of its own per tier, because a plugin route declares ONE permission
 * and the tiers are read under different grants, and because each then answers
 * the canonical list envelope. What the two share is everything about HOW a
 * collection is paged and admitted under a ceiling — one walk and one
 * admission, below — so a tier is a completion function and a permission, not
 * a copy of the loop.
 *
 * ## Patterns: published only, and NOT by saying so
 *
 * A draft pattern is one being worked on, and offering it would put a
 * half-built starting point in front of every author on the site. The read is
 * bounded to public states — but by the SERVICE, because it runs as the user,
 * and an untrusted caller that states no lifecycle gets exactly that.
 *
 * A literal `where.status = "published"` looked like the same thing and is not,
 * in two ways. It is ANDed with the service's own release-aware condition,
 * which deliberately reveals a draft belonging to a release whose time has come
 * but whose drain has not run — so the literal hides it again, and on an
 * installation with no scheduler it stays hidden indefinitely. And "published"
 * is a state NAME: a collection whose workflow calls its public state something
 * else matches nothing, and the library comes back empty with no error. The
 * service asks the workflow which states are public; this cannot.
 *
 * ## Components: every state the caller may read, with the draft overlaid
 *
 * The opposite posture, because the reader is different. The editor is where a
 * component is placed, and a component created as a draft and never published
 * is exactly the one an author building a draft page reaches for — listing
 * only public states would make it unplaceable until it was published, which
 * is the wrong way round. So the listing asks for every lifecycle state, and
 * the service still decides which ROWS this caller may see. The document then
 * comes from a by-id read that can overlay the working draft, which a listing
 * cannot — see {@link ComponentReads}.
 *
 * ## The permission follows the collection
 *
 * Each route demands the read permission of the collection it serves, COMPUTED
 * from the resolved slug rather than spelled: a host may rename a collection,
 * and a permission naming the declared slug would then be seeded under the new
 * name and refused under the old one, which is a route nobody can call.
 *
 * @module library-route
 */

import { COMPONENTS_SLUG } from "./collections/components";
import { PATTERNS_SLUG } from "./collections/patterns";
import {
  COMPONENT_LIBRARY_LOCALE_PARAM,
  COMPONENT_LIBRARY_ROUTE_PATH,
  LIBRARY_ROUTE_PATH,
  type ComponentLibraryResponse,
  type LibraryComponent,
  type LibraryListResponse,
  type LibraryPattern,
  type LibraryResponse,
} from "./library-contract";

/**
 * How many rows one read of the collection asks for.
 *
 * The service defaults to ten, which would make a library of any size a long
 * run of round trips. Large enough that an ordinary site is one request, small
 * enough that one response is not an unbounded amount of memory.
 */
export const LIBRARY_PAGE_SIZE = 100;

/**
 * The most patterns this will return, however many are stored.
 *
 * A ceiling rather than an unbounded loop, for the reason the submissions
 * export has one: a collection nothing caps could hold the whole table in
 * memory on one request. The design sizes the library at three thousand, so
 * this is the size it is expected to reach rather than a number pulled from
 * nowhere — and reaching it is REPORTED rather than silently truncating a list
 * the author would then search in vain.
 */
export const MAX_LIBRARY_PATTERNS = 3000;

/**
 * The most reads one library request will make, for a tier listing in pages
 * of `pageSize`.
 *
 * Derived from the item ceiling and the page size rather than chosen, so it
 * cannot drift from them — and it bounds the REQUESTS, which the item ceiling
 * does not. A page every row of which this reader drops adds nothing to the
 * kept count, so a ceiling counting only kept items is never reached and the
 * loop asks for page after page forever. Measured while breaking this: a stop
 * condition on the kept count spun until the process died.
 *
 * Per tier, because the two list in different page sizes: derived from the
 * one page size, a tier listing in smaller pages would be cut at a fraction
 * of the ceiling while its pages were still coming back full.
 */
function mostPages(pageSize: number): number {
  return Math.ceil(MAX_LIBRARY_PATTERNS / pageSize);
}

/**
 * The most bytes of pattern documents one library read will carry.
 *
 * A count cannot bound this. One valid blocks document may be two mebibytes by
 * default and a host may raise that cap, so three thousand of them is gigabytes
 * held in memory on the server and then sent to a browser — from a request an
 * author makes by opening the editor.
 *
 * Sixteen mebibytes: large enough that an ordinary library arrives whole, small
 * enough to be a payload rather than an outage. Reaching it is REPORTED, like
 * every other ceiling here, so the surface can say the library was cut rather
 * than let an author search for a pattern that was silently left out.
 *
 * An upper bound on what comes back, not a line the last row is allowed to
 * cross: every row is weighed before it is kept, so a response never totals
 * more than this.
 */
export const MAX_LIBRARY_BYTES = 16 * 1024 * 1024;

/**
 * What one row costs on the wire, or nothing when it cannot be sent at all.
 *
 * THE WHOLE ROW, not the document. Charging only the document meant charging
 * the one field that happened to have no bound of its own, and `description` is
 * a `textarea` on the patterns collection with no length either — so a library
 * of long descriptions and absent documents was scored at exactly zero and no
 * ceiling was ever consulted. Measured, sixty such rows serialised to 24.0 MB
 * against a 16 MiB ceiling. A budget on what is SENT has to weigh what is sent.
 *
 * The ENGINE's measurement, not a second definition of a byte, and the generic
 * one rather than `documentBytes`: that takes a document, while what travels
 * here is a row. `measureBytes` is the same survey the canonical validator asks
 * its size question through, so this agrees with the ceiling a stored document
 * already passed rather than disagreeing the first time a block gains a prop.
 * It counts UTF-8, which is what a byte means on the wire — `String.length`
 * counts UTF-16 code units, and a library measured that way passed roughly
 * three times its nominal ceiling.
 *
 * It is also BOUNDED: it stops at the limit rather than walking a row that is
 * already too big, so weighing a hundred-mebibyte row does not itself cost a
 * hundred mebibytes.
 *
 * A row that cannot be serialised is REFUSED rather than counted as free. An
 * `afterRead` hook may hand back a document holding a bigint or a cycle;
 * counting that as costing nothing kept it, and the serialisation of the
 * assembled library then threw — so one malformed row answered the author with
 * a failed request instead of a shorter list. `undefined` says so, and the
 * caller drops the row exactly as it drops one it could not key or label.
 */
function rowCost(row: LibraryPattern | LibraryComponent): number | undefined {
  const measured = measureBytes(row, MAX_LIBRARY_BYTES);
  if (measured.exceeded && measured.reason === "unwritable") return undefined;
  return measured.bytes;
}

/**
 * What the answer costs before a single pattern is in it.
 *
 * The rows are what the budget counted and the rows are not what is sent:
 * `Response.json` wraps them in `{"items":[…],"meta":{…}}`. A library whose
 * rows totalled exactly the ceiling therefore left the server ABOVE it —
 * measured, nine bytes over — so a proxy or platform limit set at the same
 * figure rejects a response this route believed it had bounded.
 *
 * Computed from the envelope rather than written down, so it cannot drift from
 * the shape actually returned, and at its WORST case: the largest count this
 * can report, and `false`, which is a byte longer than `true`.
 */
const RESPONSE_FRAMING_BYTES = measureBytes(
  {
    items: [],
    meta: { count: MAX_LIBRARY_PATTERNS, truncated: false },
  } satisfies LibraryListResponse<never>,
  Number.MAX_SAFE_INTEGER
).bytes;

/**
 * What one more row costs beyond itself: the comma that separates it.
 *
 * Charged to every row including the first, which over-counts by one byte for
 * a library of one. Conservative in the direction that keeps the ceiling a
 * ceiling, and a byte is not worth a special case.
 */
const ROW_SEPARATOR_BYTES = 1;

/**
 * One page of one collection, as the walk consumes it.
 *
 * `hasMore` is the SERVICE's answer to whether more rows exist. A page can come
 * back shorter than asked for without the collection ending — an `afterRead`
 * hook may drop rows — so a length check stops early and every row on later
 * pages disappears. It also cannot tell a library that ends exactly at the
 * ceiling from one that does not.
 */
export interface CollectionPage {
  readonly data: readonly unknown[];
  readonly hasMore: boolean;
  /**
   * The greatest id this page named, which is where the next one starts.
   *
   * Absent when it named none — an empty page, or one whose rows all arrived
   * without a readable id. Those rows are skipped anyway, so the walk keeps
   * the position it had and steps past them by offset instead; that is the one
   * case where an offset is still the only thing to go on.
   */
  readonly next?: string;
}

/** Who is asking, and which collections the host actually has. */
interface LibraryCaller {
  self: { collections: Record<string, string | undefined> };
  user: unknown;
}

/** The capabilities the pattern route uses, named rather than imported whole. */
export interface PatternLibraryContext extends LibraryCaller {
  services: {
    collections: {
      listEntries(
        collection: string,
        options: unknown,
        context: unknown
      ): Promise<{
        data: unknown[];
        pagination?: { hasMore?: boolean };
      }>;
    };
  };
}

/**
 * The two reads of the components collection the plugin-facing service cannot
 * make, injected so the route declaration is the one place that binds them and
 * a test can supply a value.
 *
 * Both reach the Direct API, and both must read AS THE USER — see
 * {@link directComponentReads} for what that takes.
 */
export interface ComponentReads {
  /**
   * One page of the collection at the EDITOR's lifecycle scope: every state,
   * with the service deciding which rows this caller may see.
   *
   * The plugin-facing listing forwards no lifecycle scope, and an untrusted
   * read that states none is bounded to public states — so a draft-only
   * component would never be listed and never be placeable.
   *
   * Ordered by `id` and paged FROM one — see {@link ListPosition}. The service
   * adds `ORDER BY` only when a sort is asked for, so the order is asked for.
   */
  list(slug: string, at: ListPosition): Promise<CollectionPage>;
  /**
   * One component by id, with its working draft overlaid where this caller may
   * edit it, or nothing.
   *
   * A listing answers with LIVE rows: the working-draft overlay lives in the
   * by-id path and nowhere else, so a definition read from the listing would
   * show an editor a stale component beside the draft they just saved. Answers
   * the ROW (whatever shape the read returns); the caller reads the content
   * field off it.
   */
  read(slug: string, id: string): Promise<unknown>;
}

/** The capabilities the component route uses. */
export interface ComponentLibraryContext extends LibraryCaller {
  components: ComponentReads;
  /** Where the definitions live: the store the plugin was told, or its own. */
  store: ComponentStore;
}

/**
 * Where component definitions are read from.
 *
 * `collection` names a store the plugin does NOT own — a host that keeps its
 * definitions in a collection of its own and renders from it; absent, the
 * plugin's contributed collection, under whatever name the host gave it.
 * `field` is the blocks field the definition lives in on that row.
 *
 * ONE statement of this, shared with the readiness notice: a host that
 * redirected the renderer says so once, and the editor's read and the notice
 * follow it together. An editor reading the plugin's store regardless drew a
 * different definition for the same id than the page did, or none. A host
 * that supplies definitions from no collection at all (`resolveComponents`
 * on its render route) is outside what any collection read can follow, and
 * the plugin says so where that option is documented.
 */
export interface ComponentStore {
  readonly collection?: string;
  readonly field: string;
}

/** The plugin's own store, read from the field the renderer defaults to. */
export const DEFAULT_COMPONENT_STORE: ComponentStore = {
  field: COMPONENT_DOCUMENT_FIELD,
};

/**
 * The component reads the route binds: the Direct API, AS THE USER.
 *
 * `overrideAccess: false` is the whole of "as the user", and it has to be
 * SAID. `requireNextly()` is the trusted server handle and defaults every
 * call to `overrideAccess: true`; passing `user` beside that default names a
 * caller and narrows nothing. On the by-id read the difference is the draft:
 * `draft: true` is an opt-in the service grants outright to an overriding
 * caller and, for everyone else, only after probing whether THIS caller may
 * update THIS row — so without the `false`, an author who may merely read a
 * component was handed its pending draft, and every field-level read rule was
 * skipped on the way. With it, a read-only caller sees the live definition.
 *
 * WHO is asking comes from the dispatcher's caller, resolved once per request
 * (`ctx.caller.identity()`): the user context with the roles a stored rule
 * reads and the verified claims a custom rule may decide on, plus the key's
 * own scope for an API-key caller — a key is judged on the grants stamped on
 * IT rather than on the roles of whoever minted it, and the account alone
 * names the minter. Built from `ctx.user` here instead, the context carried
 * no roles, and a role-based read rule on the components collection refused
 * the very caller the route's gate had admitted, with an empty library and
 * nothing to say why.
 *
 * Two answers on the by-id read are the walk's to report as a cut library
 * and nothing more: the row vanished between the two reads, or THIS caller
 * may not read it. Anything else — the database, a hook — fails the route,
 * which the client reads as unavailable and offers the retry for. The read's
 * own `disableErrors` is deliberately not asked for: it turns every failure
 * into a missing row, and a transient fault would then be reported as a
 * static ceiling with no retry, every instance on the page drawn as missing.
 *
 * `requireNextly` per call rather than captured: it refuses until services
 * are registered, and a route handler runs only after that, so the refusal
 * can only fire on a misconfigured boot — where failing loudly is right.
 *
 * Both reads name the LOCALE the request asked for, when it asked for one. A
 * component's document field can be localized, and the public renderer reads
 * definitions in the page's locale; an editor whose reads named none would
 * draw an author editing German a canvas of English components. Both reads,
 * because a listing in one language completed by rows in another labels one
 * version and draws the other. None named is the app default, as an absent
 * `?locale=` is everywhere in the admin — and an unknown code resolves to the
 * default in the Direct API, so nothing here has to know the site's languages.
 */
function directComponentReads(
  ctx: Pick<PluginRouteContext, "caller">,
  locale?: string
): ComponentReads {
  const inLocale = locale === undefined ? {} : { locale };
  // Resolved once for both reads, and lazily: the caller resolves its own
  // identity once per request, and a route with nothing to read never asks.
  // A public route has no caller; this one is gated, so the anonymous branch
  // is the honest answer for a context nothing authenticated.
  const asUser = async () => {
    const identity = await ctx.caller?.identity();
    return {
      overrideAccess: false as const,
      user: identity?.user,
      ...(identity?.authenticatedScope === undefined
        ? {}
        : { actor: identity.authenticatedScope }),
    };
  };
  return {
    list: async (slug, at) => {
      const result = await requireNextly().find({
        collection: slug,
        ...(await asUser()),
        ...inLocale,
        status: "all",
        sort: "id",
        ...queryAt(at),
        limit: COMPONENT_LIST_PAGE_SIZE,
      });
      return page(result.items, result.meta.hasNext);
    },
    read: async (slug, id) => {
      try {
        return await requireNextly().findByID({
          collection: slug,
          id,
          ...(await asUser()),
          ...inLocale,
          // Every lifecycle state HERE TOO. The listing asked for every state
          // and got the never-published row; a by-id read that stated none is
          // bounded back to public states and answers 404 for that same row —
          // the overlay runs only on a row the lifecycle filter let through.
          status: "all",
          draft: true,
        });
      } catch (error) {
        if (NextlyError.isNotFound(error) || NextlyError.isForbidden(error)) {
          return null;
        }
        throw error;
      }
    },
  };
}

/**
 * Read the pattern library, as the user asking for it.
 *
 * Separate from the route declaration so it can be tested against a stub
 * without a server: what this decides — which rows travel, how many, and what
 * of each — is the part worth holding still, and a handler that only exists
 * inside `contributes.routes` can only be tested by booting one.
 */
export async function readPatternLibrary(
  ctx: PatternLibraryContext
): Promise<LibraryResponse> {
  const slug = ctx.self.collections[PATTERNS_SLUG] ?? PATTERNS_SLUG;
  // AS THE USER. A route reading with the instance's own identity would answer
  // every caller with every row, whatever the collection's permissions say.
  // NO status predicate, deliberately — see the module docblock. And the same
  // deterministic order the component listing asks for, for the same reason.
  const asUser = { as: "user" as const, user: ctx.user ?? undefined };
  return envelope(
    await readTier(
      async at => {
        const { page: pageNumber, ...filter } = queryAt(at);
        const result = await ctx.services.collections.listEntries(
          slug,
          {
            sort: { field: "id", direction: "asc" as const },
            pagination: { limit: LIBRARY_PAGE_SIZE, page: pageNumber },
            ...filter,
          },
          asUser
        );
        return page(result.data, result.pagination?.hasMore === true);
      },
      row => readLibraryRow(row) ?? "skip",
      LIBRARY_PAGE_SIZE
    )
  );
}

/**
 * Read the component library: metadata from the listing, the document from a
 * by-id read that can see the working draft.
 *
 * Two reads per component rather than one, and the second is the point. The
 * listing is what pages the collection deterministically and applies the
 * caller's access; the by-id read is the only path to the draft overlay. A
 * component whose by-id read answers nothing — the row vanished between the
 * two, or the service declined — is left out and the tier marked cut, since
 * a library missing a definition the author can see in the collection is not
 * a whole library.
 */
export async function readComponentLibrary(
  ctx: ComponentLibraryContext
): Promise<ComponentLibraryResponse> {
  const slug =
    ctx.store.collection ??
    ctx.self.collections[COMPONENTS_SLUG] ??
    COMPONENTS_SLUG;
  return envelope(
    await readTier(
      page => ctx.components.list(slug, page),
      row => completeComponent(ctx, slug, row),
      COMPONENT_LIST_PAGE_SIZE
    )
  );
}

/**
 * Where one page of a listing starts.
 *
 * An id rather than a count, because these are independent queries against a
 * collection other authors are editing: an offset moves when a row before it
 * is inserted or deleted, so one row comes back twice and another never at
 * all — and the one never returned is never completed, so `omitted` stays
 * false and the response reports a whole library the canvas has no definition
 * for. "The rows after this id" means the same thing however many rows before
 * it moved.
 *
 * `page` is what is left of the offset, and it counts pages since `after` last
 * MOVED — not since the walk began. It exists for the one page that names no
 * id at all: every row on it arrived without a readable one, so it names no
 * position, and stepping past it is the only way to reach what is behind it.
 * A page that names an id resets it to 1, so the ordinary walk never uses it
 * beyond the first page and never carries an offset a mutation can move.
 */
export interface ListPosition {
  /** The greatest id already seen, absent before the first page. */
  readonly after?: string;
  /** Pages read since `after` last moved, 1-indexed. */
  readonly page: number;
}

/**
 * The filter that asks for the rows after one id, or nothing for the first
 * page.
 *
 * Spelled once because both tiers page the same way through two different
 * services, and the `id` sort they already ask for is what makes it a
 * position: ordered by id, "after this id" and "after this row" are the same
 * sentence, and it means the same thing however many rows before it were
 * inserted or deleted while the walk was running.
 *
 * Not a framework filter. The exemption exists for reads that ADDRESS a field
 * the caller may not read, and this one addresses the ids the caller was just
 * handed — a caller who may not read `id` is a caller whose rows this walk
 * skips anyway, and refusing the filter is the honest answer for them.
 */
function queryAt(at: ListPosition): {
  where?: { id: { greater_than: string } };
  page: number;
} {
  return {
    ...(at.after === undefined
      ? {}
      : { where: { id: { greater_than: at.after } } }),
    page: at.page,
  };
}

/**
 * One page as the walk consumes it: the rows, whether more exist, and the id
 * the next page starts after.
 *
 * The cursor is the greatest id the page named, so it is a position in the
 * collection's own order rather than a count of rows this read happened to
 * receive.
 */
function page(rows: readonly unknown[], hasMore: boolean): CollectionPage {
  // From the END, because the rows are ordered by id: the last one carrying a
  // usable id is the greatest. Rows past it named no position and are skipped
  // by the completion anyway, so reading them once more costs nothing and
  // losing them costs a definition.
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (typeof row !== "object" || row === null) continue;
    const id = (row as Record<string, unknown>).id;
    if (typeof id === "string" && id !== "") {
      return { data: rows, hasMore, next: id };
    }
  }
  return { data: rows, hasMore };
}

/** One tier's read: what it kept, and whether it was cut. */
interface TierRead<T> {
  readonly items: T[];
  readonly truncated: boolean;
}

/** The canonical list envelope, built in one place so neither route drifts. */
function envelope<T>(tier: TierRead<T>): LibraryListResponse<T> {
  return {
    items: tier.items,
    meta: { count: tier.items.length, truncated: tier.truncated },
  };
}

/**
 * Page one collection, completing and admitting each row.
 *
 * ONE walk for both tiers. The stop rule and the ceiling are properties of a
 * RESPONSE, not of either collection, and two walks would let one tier's
 * paging drift from the other's the first time either was edited alone. What
 * differs per tier is where a page comes from, how a listed row becomes an
 * item, and how many rows one page carries — and all three are handed in,
 * the last so the bound on reads is derived here from the size it bounds.
 */
async function readTier<T extends LibraryPattern | LibraryComponent>(
  pageAt: (at: ListPosition) => Promise<CollectionPage>,
  complete: (row: unknown) => Promise<Completed<T>> | Completed<T>,
  pageSize: number
): Promise<TierRead<T>> {
  const lastPage = mostPages(pageSize);
  const items: T[] = [];
  let truncated = false;
  // Accumulated rather than assigned, unlike `truncated`: an oversized row on
  // page one is a cut library even when page nine simply ends, and the stop
  // reason below overwrites what it knows nothing about.
  let omitted = false;
  // Seeded with the framing, so the ceiling bounds the ANSWER rather than the
  // rows inside it.
  let bytes = RESPONSE_FRAMING_BYTES;
  let at: ListPosition = { page: 1 };
  for (let read = 1; ; read += 1) {
    const result = await pageAt(at);
    const kept = await collect(result.data, complete, items, bytes);
    bytes = kept.bytes;
    omitted ||= kept.omitted;
    if (kept.full) {
      truncated = true;
      break;
    }
    const stop = whyStop({ hasMore: result.hasMore, read, lastPage });
    if (stop !== undefined) {
      truncated = stop === "cut";
      break;
    }
    // A page that named an id moves the position and starts the offset over;
    // one that named none leaves the position where it was and steps past
    // itself.
    at =
      result.next === undefined
        ? { ...at, page: at.page + 1 }
        : { after: result.next, page: 1 };
  }
  return { items, truncated: truncated || omitted };
}

/**
 * A component's completion: the listing names it, the by-id read describes it.
 *
 * EVERYTHING the item carries comes from the by-id row — the title and
 * category as much as the document. That row is the one with the working
 * draft overlaid, and a draft can rename a component or move it to another
 * category as readily as it can change its content; an item labelled from the
 * live listing and drawn from the draft would be searched, grouped and named
 * by one version and rendered as another.
 *
 * Skipped when the listing could not name it; omitted — and counted — when
 * the listing showed it but the by-id read found nothing, or found a row it
 * could not shape.
 */
async function completeComponent(
  ctx: ComponentLibraryContext,
  slug: string,
  row: unknown
): Promise<Completed<LibraryComponent>> {
  const listed = identityOf(row);
  if (listed === undefined) return "skip";
  const data = await ctx.components.read(slug, listed.named.id);
  return withDraftDocument(data, ctx.store.field, listed.named.id) ?? "omit";
}

/**
 * What every library row must carry to be offered at all: a non-empty id.
 * ONE reader for both tiers, because the two collections share this half of
 * their shape and a second reading of it would drift from the first the day
 * either learned a new way a row can be unusable.
 *
 * A title only LABELS the row, so a row without one is labelled by its id
 * rather than left out. What a page's renderer reads of a component is its id
 * and its document; a collection with no title field, or one whose title is
 * redacted by field-level access, still renders every instance on the public
 * page, and a canvas that dropped the definition would draw a placeholder
 * where the page draws the component. The id is the one name a row is sure
 * to have, and an author can find it by that.
 */
function identityOf(
  row: unknown
):
  | { named: { id: string; title: string }; record: Record<string, unknown> }
  | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const record = row as Record<string, unknown>;
  const { id, title } = record;
  if (typeof id !== "string" || id === "") return undefined;
  return { named: { id, title: labelFor(title, id) }, record };
}

/**
 * What a row is called: its title, or its id where it has no readable one.
 *
 * The id is the one name a row is sure to have. A collection with no title
 * field, or one whose title field-level access redacts, still renders every
 * instance on the public page — so a canvas that dropped the row would draw a
 * placeholder where the page draws the component, and an author can find it
 * by its id.
 *
 * One rule for both rows a component passes through. Spelled twice, the
 * listing and the draft would eventually disagree about what an unnamed
 * component is called.
 */
function labelFor(title: unknown, id: string): string {
  return typeof title === "string" && title !== "" ? title : id;
}

/**
 * Whether a by-id row is the row that was asked for.
 *
 * A row carrying NO id is: field-level access drops it in presentation, which
 * is why the id comes from the listing at all. A row carrying a DIFFERENT one
 * is not — a `beforeOperation` hook can redirect the read, so the record
 * answering for one component may be another's, and taking the listing's id
 * would serve one component's draft under the other's name with nothing
 * anywhere saying so.
 */
function answersFor(record: Record<string, unknown>, id: string): boolean {
  const own = record.id;
  return typeof own !== "string" || own === "" || own === id;
}

/**
 * The by-id row as one item: how the panel labels it, and the document as the
 * caller should see it.
 *
 * The id is the LISTING's, never the by-id row's. That row is a presentation
 * of the same record — field-level access may drop its `id` — while stored
 * instances reference the id the collection holds, which is the one the
 * listing named. Keyed by the presentation, the client's definitions answer to
 * a name no instance uses and every instance of it draws as missing.
 * Everything else — the title, the category, the description and the content —
 * is the by-id row's, because that is the one carrying the draft.
 *
 * A row naming a DIFFERENT id is the other thing that can produce: a
 * `beforeOperation` hook can redirect the read, so the record answering for
 * one component may be another's. Taking the listing's id then serves one
 * component's draft under the other's name, and nothing anywhere says so.
 * Nothing is taken from it at all.
 *
 * `document: null` for a row the read found but which holds no content — a
 * legal row, and one the panel will skip, because the field layer writes an
 * unset non-required field as SQL `NULL` and reads it back with the key
 * PRESENT. A row with no key at all is a different answer: field-level access
 * or an `afterRead` hook removed the field, so this caller did not read the
 * row whole, and a definition the client needs is missing rather than empty.
 *
 * `undefined` for every one of those, which the caller reports as a cut
 * library rather than as a missing key.
 */
function withDraftDocument(
  data: unknown,
  field: string,
  id: string
): LibraryComponent | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const record = data as Record<string, unknown>;
  if (!answersFor(record, id)) return undefined;
  // `hasOwn`, not `in`: the field name is the site's to configure, and one
  // naming something on `Object.prototype` would read a function as a
  // document.
  if (!Object.hasOwn(record, field)) return undefined;
  const content = record[field];
  return {
    id,
    title: labelFor(record.title, id),
    ...optionalText(record.description, "description"),
    ...optionalText(record.category, "category"),
    document:
      content === undefined || content === null
        ? null
        : (content as LibraryComponent["document"]),
  };
}

/** What one page added, and whether the ceilings are now reached. */
interface Collected {
  /** The running byte total, including this page. */
  readonly bytes: number;
  /** Whether a ceiling stopped the collection part-way. */
  readonly full: boolean;
  /**
   * Whether a row was left out for its own size while the read went on.
   *
   * Told apart from {@link full} because the two say different things about
   * what happens next: a spent budget ends the read, while a pattern that fits
   * in no budget is one row skipped. Both mean the library is incomplete, which
   * is the one thing the panel has to be told.
   */
  readonly omitted: boolean;
}

/** What the ceilings say about one row, before it is appended to anything. */
type RowVerdict = "keep" | "omit" | "stop";

/**
 * Whether this row travels, decided BEFORE it is appended.
 *
 * Appending and then checking makes the ceiling a description of the response
 * rather than a bound on it: the row that crosses the budget has already been
 * kept, so a single document larger than the whole budget comes back whole.
 * Measured, that returned 17.8 MB against a 16 MiB ceiling.
 *
 * A row that does not fit in an EMPTY budget fits in no budget, so it is
 * omitted and the read goes on. Ending there would hide every pattern behind
 * it on account of one the panel could not have offered anyway — the same
 * direction an unreadable row moves in, one pattern dropped instead of all of
 * them. A row that would merely overflow what is LEFT means the budget is
 * spent, and reading further only assembles bytes that cannot be sent.
 */
function admits(charged: number, spent: number, kept: number): RowVerdict {
  // Against an EMPTY response rather than against nothing: a row that cannot
  // fit beside the framing alone cannot fit anywhere.
  if (RESPONSE_FRAMING_BYTES + charged > MAX_LIBRARY_BYTES) return "omit";
  if (spent + charged > MAX_LIBRARY_BYTES) return "stop";
  if (kept >= MAX_LIBRARY_PATTERNS) return "stop";
  return "keep";
}

/**
 * What completing a listed row can answer.
 *
 * Three outcomes, because two absences mean different things. A row the
 * listing itself could not shape — no id, no title — is SKIPPED: nothing was
 * promised. A row the listing showed but which cannot be completed — a by-id
 * read that answered nothing — is OMITTED, and counted, because the caller saw
 * that row exist and a library without it is not whole.
 */
type Completed<T> = T | "skip" | "omit";

/**
 * How many rows are completed at once.
 *
 * A component's completion is a database round trip, and a library the
 * design sizes at three thousand completed one row at a time is three thousand
 * sequential round trips on every editor open — past any request timeout.
 * Completed all at once, a page that meets the ceiling at its first row pays
 * ninety-nine reads it will never admit. Eight at a time bounds both: the
 * wait is a fraction of the serial one, and at most seven reads past the
 * ceiling are spent.
 */
export const COMPLETION_CONCURRENCY = 8;

/**
 * How many rows one read of the COMPONENT listing asks for: one completion
 * batch.
 *
 * The listing only names rows; every field of an item comes from the by-id
 * read that follows, so the content a listed row carries is read for
 * nothing. And it IS carried: the service reads whole rows however a caller
 * narrows the answer — `select` projects the rows after they are read, so a
 * projection would trim the reply and not the read. A page of a hundred rows
 * held while its batches completed was therefore a hundred documents of
 * content in memory at once, at the document ceiling roughly two hundred
 * mebibytes for a listing that keeps two strings of each. Sized to the batch,
 * what is held is one batch of listed rows and one batch of by-id rows, and
 * the bound on reads grows to match so the tier still reaches the ceiling.
 */
export const COMPONENT_LIST_PAGE_SIZE = COMPLETION_CONCURRENCY;

/**
 * One page of rows, each completed and then admitted under the ceiling.
 *
 * ONE admission for both tiers. The cost, the charge, the verdict and the push
 * are the ceiling's rule, and the ceiling is one number shared by one response
 * — two copies of how a row is admitted against it would be two ceilings the
 * first time either was edited alone. What differs per tier is only how a
 * listed row becomes an item, and that is the `complete` step handed in: a
 * pattern is whole from the listing, a component needs a by-id read.
 *
 * Completed in bounded batches and admitted IN ORDER: a batch runs its reads
 * together, and its rows are then judged one after another exactly as a
 * serial walk would judge them, so the ceiling cuts the same rows whatever the
 * batch size. A batch is not started once the ceiling has stopped the read.
 */
async function collect<T extends LibraryPattern | LibraryComponent>(
  rows: readonly unknown[],
  complete: (row: unknown) => Promise<Completed<T>> | Completed<T>,
  into: T[],
  from: number
): Promise<Collected> {
  let bytes = from;
  let omitted = false;
  for (let start = 0; start < rows.length; start += COMPLETION_CONCURRENCY) {
    // Each completion wrapped as a promise: a pattern's completes at once and
    // a component's waits on a read, and the aggregator takes one shape.
    const batch = await Promise.all(
      rows
        .slice(start, start + COMPLETION_CONCURRENCY)
        .map(async row => complete(row))
    );
    const admitted = admitAll(batch, into, bytes);
    bytes = admitted.bytes;
    omitted ||= admitted.omitted;
    if (admitted.full) return { bytes, full: true, omitted };
  }
  return { bytes, full: false, omitted };
}

/** One batch of completed rows, admitted in order until the ceiling says stop. */
function admitAll<T extends LibraryPattern | LibraryComponent>(
  batch: readonly Completed<T>[],
  into: T[],
  from: number
): Collected {
  let bytes = from;
  let omitted = false;
  for (const item of batch) {
    if (item === "skip") continue;
    const size = item === "omit" ? undefined : rowCost(item);
    if (item === "omit" || size === undefined) {
      omitted = true;
      continue;
    }
    const charged = size + ROW_SEPARATOR_BYTES;
    const verdict = admits(charged, bytes, into.length);
    if (verdict === "stop") return { bytes, full: true, omitted };
    if (verdict === "omit") {
      omitted = true;
      continue;
    }
    into.push(item);
    bytes += charged;
  }
  return { bytes, full: false, omitted };
}

/**
 * Whether to ask for another page, and if not, why.
 *
 * Only the reasons that are about the READ rather than about what was kept. The
 * pattern and byte ceilings live in the row loop, because a ceiling checked
 * between pages bounds nothing about the page being read.
 *
 * Told apart as `"ended"` and `"cut"` because only one is something to report:
 * a library that finished is complete, and one that was cut is a library an
 * author would otherwise search in vain.
 */
function whyStop(at: {
  hasMore: boolean;
  read: number;
  lastPage: number;
}): "ended" | "cut" | undefined {
  // The SERVICE's own answer, not a length this recomputes. A page shorter than
  // asked for does not mean the collection ended: an `afterRead` hook may drop
  // rows, and stopping there loses every pattern behind them.
  if (!at.hasMore) return "ended";
  // A bound on the READS, which the per-row ceilings cannot supply: they count
  // what was KEPT, and a page whose every row was dropped keeps none. Counted
  // over the whole walk rather than per position, because that is what it
  // bounds — the requests this one response makes.
  if (at.read >= at.lastPage) return "cut";
  return undefined;
}

/**
 * One stored row, as the panel needs it — or nothing when it is not one.
 *
 * Every field is read defensively. These are stored documents reaching a
 * reader, and a field the collection does not require is written as SQL `NULL`
 * and read back with the KEY PRESENT: `keywords` arrives as `null` for the
 * ordinary pattern saved without any, which is why it is carried as `null`
 * rather than normalised away. The panel's own reader already expects that.
 */
function readLibraryRow(row: unknown): LibraryPattern | undefined {
  const identity = identityOf(row);
  if (identity === undefined) return undefined;
  return { ...identity.named, ...describedBy(identity.record) };
}

/**
 * The fields a pattern may or may not carry, read off one row.
 *
 * Separate from the identity check above because they answer different
 * questions — whether this row is a pattern at all, and what it says about
 * itself — and because reading them is where all the branching is.
 */
function describedBy(record: Record<string, unknown>): Partial<LibraryPattern> {
  return {
    ...optionalText(record.description, "description"),
    ...optionalText(record.category, "category"),
    ...optionalText(record.granularity, "granularity"),
    ...storedKeywords(record.keywords),
    // The collection stores the tree under `content`; the panel reads
    // `document`. Named here, once, because this is the only place that knows
    // both — and because getting it wrong drops every pattern in silence.
    //
    // Carried whole and unread. What a pattern document must BE is the
    // planner's question, and it asks it before offering the pattern; a second
    // reading here would be a narrower one that disagrees the first time the
    // format gains a field.
    ...(record.content === undefined
      ? {}
      : { document: record.content as LibraryPattern["document"] }),
  };
}

/**
 * The author's search terms, including the `null` a stored row really holds.
 *
 * `null` is carried through rather than normalised away: Nextly writes an unset
 * non-required field as SQL `NULL` and reads it back with the KEY PRESENT, so
 * the ordinary pattern saved without keywords arrives as `null` — and the
 * panel's own keyword reader is written to meet exactly that.
 */
function storedKeywords(value: unknown): { keywords?: string | null } {
  if (value === null) return { keywords: null };
  return typeof value === "string" ? { keywords: value } : {};
}

/** One optional string field, present only when it is actually a string. */
function optionalText(
  value: unknown,
  name: string
): Record<string, string> | Record<string, never> {
  return typeof value === "string" ? { [name]: value } : {};
}

/** The shape of one contributed library route, as `contributes.routes` reads it. */
interface LibraryRoute {
  method: "GET";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
}

/**
 * The pattern route declaration, thin on purpose.
 *
 * Everything it decides lives in {@link readPatternLibrary}, which a test can
 * reach without booting a server. What is left here is the shape of the
 * contribution — the method, the path, and which permission it demands — and
 * that is the part a reader of `contributes.routes` needs to see without
 * following a call.
 */
export function patternLibraryRoute(): LibraryRoute {
  return {
    method: "GET",
    path: LIBRARY_ROUTE_PATH,
    // No `public: true`, which is what makes this authenticated, and a COMPUTED
    // `requiredPermission`, which is what keeps it callable on a site that
    // renamed the collection. See the module docblock.
    requiredPermission: ({ collection }) => collection(PATTERNS_SLUG, "read"),
    handler: async (_req: Request, ctx: PluginRouteContext) =>
      Response.json(await readPatternLibrary(ctx)),
  };
}

/**
 * The component route declaration: the same shape, its own permission.
 *
 * `read` on the COMPONENTS collection, resolved the same way — or on the
 * store the plugin was told components live in, which the scope helper names
 * as given when the plugin never contributed it. A role that may read
 * components and not patterns gets its definitions here, which the pattern
 * route's gate would have refused — and every instance on its pages would
 * have drawn as a placeholder.
 */
export function componentLibraryRoute(
  store: ComponentStore = DEFAULT_COMPONENT_STORE
): LibraryRoute {
  return {
    method: "GET",
    path: COMPONENT_LIBRARY_ROUTE_PATH,
    requiredPermission: ({ collection }) =>
      collection(store.collection ?? COMPONENTS_SLUG, "read"),
    handler: async (req: Request, ctx: PluginRouteContext) =>
      Response.json(
        await readComponentLibrary({
          ...ctx,
          components: directComponentReads(ctx, requestedLocale(req)),
          store,
        })
      ),
  };
}

/**
 * The language the request asks the component tier in, or none.
 *
 * Read from the query the client writes through the shared contract
 * (`componentLibraryPath`). An empty value is none: an empty string handed to
 * the Direct API is not a language, and it is what a client formatting an
 * absent code carelessly would send.
 */
function requestedLocale(req: Request): string | undefined {
  const locale = new URL(req.url).searchParams.get(
    COMPONENT_LIBRARY_LOCALE_PARAM
  );
  return locale === null || locale === "" ? undefined : locale;
}
