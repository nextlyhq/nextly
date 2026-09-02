/**
 * GET / PUT `/api/dashboard/layout`
 *
 * One reader's arrangement of the dashboard: which cards, in which order, at
 * which size, and which they have put away.
 *
 * ## The response is resolved, not stored
 *
 * A GET never returns the row. It returns the row RESOLVED against the live
 * registry: placements whose widget no longer exists are gone, and so are
 * placements whose widget declares a `requiredPermission` this caller does not
 * hold. Both are dropped silently -- not drawn as an empty slot, not drawn as a
 * "you may not see this" card. Either of those would disclose that the widget
 * is there, which is the whole thing a permission on a card is for.
 *
 * That resolution happens on EVERY read rather than at save time, which is why
 * a placement stores no copy of `requiredPermission`. Tightening a permission
 * takes effect on the next request; a copy would have frozen the old answer
 * into the reader's row.
 *
 * ## Why a PUT does not simply overwrite
 *
 * 🔴 The wire contract is a whole snapshot, and the snapshot a client holds has
 * already been filtered. Writing it back verbatim would DELETE every placement
 * the filter hid -- so a reader who opened the dashboard once while a
 * permission of theirs was narrowed, or while a plugin was briefly disabled,
 * would silently and permanently lose those cards. So the writer merges: the
 * submitted placements replace what this caller could see, and everything they
 * could not see is carried through untouched.
 *
 * @module api/widget-layout
 */

import type { ReadAccessCaller } from "../auth/entity-read-access";
import type { AuthContext } from "../auth/middleware";
import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import {
  allWidgets,
  declaredWidgets,
  type CanonicalWidget,
} from "../domains/widgets/canonical";
import { refreshCollectionWidgets } from "../domains/widgets/collection-widgets";
import {
  MAX_LAYOUT_BYTES,
  MAX_PLACEMENTS,
  defaultPlacements,
  layoutSizeProblem,
  mergePreservingHidden,
  partitionPlacements,
  readPlacements,
  visibilityToken,
  type WidgetPlacement,
} from "../domains/widgets/layout";
import {
  holdsWidgetPermission,
  permissionVerdicts,
  readableCollections,
} from "../domains/widgets/visibility";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import {
  NO_STORED_LAYOUT_VERSION,
  type WidgetLayoutService,
} from "../services/widgets/widget-layout-service";

import {
  PRIVATE_NO_STORE_HEADERS,
  readAccessCaller,
  readCaller,
} from "./authenticated-read";
import { readBoundedJsonBody } from "./read-json-body";
import {
  respondAction,
  respondData,
  respondMutation,
  SKIP_DATE_FORMATTING_HEADER,
} from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

/**
 * Headers every layout response carries.
 *
 * 🔴 The date-formatting opt-out is load-bearing, not tidiness. The route
 * handler rewrites date-looking strings in every JSON payload by VALUE, not
 * merely by key name, to present stored timestamps in the installation's
 * timezone — so a plugin's opaque `placement.config` of
 * `{ cutoff: "2026-09-02T04:00:00.000Z" }` comes back as
 * `"2026-09-02T00:00:00.000-04:00"`. The client then submits that transformed
 * value in its next whole-snapshot PUT and it is persisted, so a configuration
 * this endpoint promises to treat as opaque does not survive a round trip, and
 * drifts one timezone offset further on every save.
 *
 * `config` is configuration rather than records, which is precisely the case
 * {@link SKIP_DATE_FORMATTING_HEADER} exists for. The header is internal and is
 * stripped before the response reaches a client.
 */
const OPAQUE_CONFIG_HEADERS = {
  ...PRIVATE_NO_STORE_HEADERS,
  [SKIP_DATE_FORMATTING_HEADER]: "1",
} as const;

/** Which layer the returned arrangement came from. */
type LayoutSource = "own" | "default";

/**
 * The default arrangement, split by what this caller may see.
 *
 * ONE materialization, asked in one place. Both halves come from the same
 * sorted set, because positions are indices into it: two calls that filtered
 * differently would give the carried half positions that collide with the
 * visible one, and a reader gaining a permission would find their arrangement
 * silently reordered.
 *
 * Materialized from {@link declaredWidgets} rather than from every widget that
 * exists. A card core GENERATED for a collection is offered through
 * `available`, never placed -- so it must not take a default position, and must
 * not spend one of the placements a caller may submit.
 */
function defaultRow(visibleIds: ReadonlySet<string>): {
  visible: WidgetPlacement[];
  invisible: WidgetPlacement[];
} {
  return partitionPlacements(defaultPlacements(declaredWidgets()), visibleIds);
}

/**
 * The placements a write must carry through untouched.
 *
 * Two cases, and the second is the one that is easy to miss. With a stored row,
 * it is the placements this caller could not see. With NO stored row, the
 * caller was still shown a FILTERED default set — so a first save would freeze
 * a snapshot that never contained the gated defaults, and a permission granted
 * afterwards could never reveal them: `defaultPlacements` runs only while the
 * row is absent, and after that first write it never runs again. The visibility
 * token catches a grant that lands BETWEEN the read and the write; it cannot
 * catch one that lands after a successful save. So the invisible half of the
 * default set is carried into the first row exactly as a stored row's invisible
 * half is carried into every later one.
 *
 * Derived from `defaultPlacements` over the WHOLE registry rather than
 * generated separately, so a carried default keeps the position it would have
 * had — and so there is one implementation of "where does an unplaced widget
 * go" rather than two that agree today.
 */
function carriedPlacements(
  storedPlacements: readonly WidgetPlacement[] | undefined,
  visibleIds: ReadonlySet<string>
): WidgetPlacement[] {
  if (storedPlacements) {
    return partitionPlacements(storedPlacements, visibleIds).invisible;
  }
  return defaultRow(visibleIds).invisible;
}

/**
 * The default arrangement as this caller sees it: materialized over the WHOLE
 * registry, then filtered.
 *
 * 🔴 Materializing over the filtered set instead produces positions that
 * COLLIDE with the carried half. Positions come from a placement's index in the
 * sorted set, so with visible defaults A and B surrounding a gated G, filtering
 * first gives A=0 and B=10, while the carried half — materialized over the full
 * registry — gives G=10. The stored row then holds two placements at 10, and
 * once the permission is granted the tie sorts A, B, G instead of the declared
 * A, G, B: the reader's arrangement silently reorders itself the moment they
 * gain access to something.
 *
 * So there is ONE materialization and two views of it, rather than two
 * materializations that agree only while nothing is hidden.
 */
function visibleDefaults(
  widgets: readonly CanonicalWidget[]
): WidgetPlacement[] {
  const visibleIds = new Set(widgets.map(widget => widget.id));
  return (
    defaultRow(visibleIds)
      .visible // 🔴 The submission cap applies HERE, to what this caller can actually
      // send, rather than to the materialization above. `layoutSizeProblem`
      // refuses a submission over `MAX_PLACEMENTS`, so an install declaring
      // more than that answered the read with a default the reader's first
      // gesture could never save -- the dashboard was simply not arrangeable.
      //
      // On the visible half rather than the whole set, because the whole set
      // includes widgets this caller may not know exist: capping before the
      // partition let two hundred denied widgets exhaust the allowance and
      // hand an ungated one an empty dashboard. Positions still come from the
      // whole-registry materialization, so nothing about the carried half
      // moves. The surplus is offered through `available`.
      .slice(0, MAX_PLACEMENTS)
  );
}

/**
 * The scope a layout belongs to today.
 *
 * Every row this endpoint writes is the caller's own, so there is exactly one
 * scope kind to resolve and no resolution ORDER to get wrong yet. The key
 * reserves the dimension anyway: a second kind of owner added after rows exist
 * is a migration, and reserving one column now costs nothing.
 */
const SCOPE_KIND = "user" as const;

async function getLayoutService(): Promise<WidgetLayoutService> {
  await getCachedNextly();
  return container.get<WidgetLayoutService>("widgetLayoutService");
}

/**
 * The widgets this caller is permitted to know exist.
 *
 * A widget with no `requiredPermission` is visible to any authenticated
 * reader -- that is what omitting it means, and it is what core's own four
 * cards rely on. A widget that declares one is asked about, and the decision is
 * taken through the same bounded rounds `authorizationGroups` prescribes for
 * the query batch: a permission check resolves a session caller through a
 * per-user TTL cache, so firing thirty of them at once makes every one a miss.
 *
 * Verdicts are memoized per SLUG, not per widget: several widgets commonly
 * name the same permission, and asking twice is two database reads for one
 * answer.
 */

async function visibleWidgets(
  caller: ReadAccessCaller
): Promise<CanonicalWidget[]> {
  // Same freshness the admin's own payload gets. Without this the endpoint
  // would place and offer a set derived on some earlier request -- a collection
  // created since would have no card to add, and one deleted since would still
  // be offered and then refused on save.
  await refreshCollectionWidgets();
  const all = allWidgets();

  const verdicts = await permissionVerdicts(
    all.map(widget => widget.requiredPermission),
    caller
  );

  // 🔴 A GENERATED card is gated on its collection, not on a declared
  // permission — it carries none. `callerHoldsPermission` judges an API key on
  // its stamped grant alone, while `canReadEntity` also evaluates the
  // collection's code-defined rules, and the widget query endpoint asks the
  // second. A key those rules reject had the card offered here and every query
  // for it refused. The same question, asked once per collection.
  const readable = await readableCollections(
    all.map(widget => widget.collection),
    caller
  );

  return all.filter(widget => {
    if (widget.generated === true) {
      return widget.collection !== undefined && readable.has(widget.collection);
    }
    return holdsWidgetPermission(widget.requiredPermission, verdicts);
  });
}

/**
 * The version the client must echo back.
 *
 * An unreadable row keeps its real version rather than reporting 0. Reporting 0
 * would tell the client "there is no row", and its next PUT would take the
 * INSERT path and collide with the row that is still sitting there -- turning a
 * recoverable bad row into a dashboard that cannot be saved at all. Echoing the
 * true version lets the next PUT overwrite the unreadable row, which is exactly
 * the repair the reader is trying to perform.
 */
export const getWidgetLayout = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  const service = await getLayoutService();
  const caller = readAccessCaller(await readCaller(auth));

  const [stored, widgets] = await Promise.all([
    service.getLayout(SCOPE_KIND, caller.userId),
    visibleWidgets(caller),
  ]);

  const source: LayoutSource = stored.layout ? "own" : "default";
  const placements = stored.layout
    ? partitionPlacements(
        stored.layout.placements,
        new Set(widgets.map(widget => widget.id))
      ).visible
    : visibleDefaults(widgets);

  // Widgets this caller may see and has not placed. A stored arrangement is a
  // full snapshot, so a widget registered AFTER the reader last saved has no
  // placement in it and appears nowhere in `placements` — which is correct, and
  // is the decision this product has taken: a newly installed plugin's card is
  // never inserted into somebody's arrangement behind their back.
  //
  // 🔴 But "not auto-added" only works if it is ADDABLE, and without this the
  // widget was discoverable from nothing: the card was absent from every read,
  // the next write persisted a snapshot that still lacked it, and the reader
  // had no way to learn it existed. Naming the unplaced set is what makes the
  // prompt possible, and it costs nothing to a client that ignores it.
  //
  // Ids only. Titles and icons already reach the admin through the widget
  // metadata it renders from; what only this endpoint can answer is WHICH of
  // them this caller is allowed to know about.
  const placed = new Set(placements.map(placement => placement.widgetId));
  const available = widgets
    .map(widget => widget.id)
    .filter(id => !placed.has(id));

  return respondData(
    {
      placements,
      available,
      version: stored.version,
      source,
      scope: visibilityToken(widgets.map(w => w.id)),
    },
    { headers: OPAQUE_CONFIG_HEADERS }
  );
});

/**
 * Reads the `version` a PUT is guarded by.
 *
 * A non-integer is refused rather than coerced. `Number("")` is 0, which is the
 * "there is no row yet" version -- so a client that omitted the field, or sent
 * an empty string, would be read as asserting the row does not exist and would
 * overwrite a real arrangement through the insert path.
 */
function readVersion(body: Record<string, unknown>): number {
  const { version } = body;
  if (!Number.isInteger(version) || (version as number) < 0) {
    throw NextlyError.validation({
      errors: [
        {
          path: "version",
          code: "INVALID_VALUE",
          message: `"version" must be a non-negative integer; send ${NO_STORED_LAYOUT_VERSION} if you have never read one.`,
        },
      ],
    });
  }
  return version as number;
}

/**
 * Reads the visibility token a PUT must echo.
 *
 * Required, not optional. An optional token would be absent for every client
 * that has not been updated -- which is every client that has the bug this
 * token exists to prevent.
 */
function readScope(body: Record<string, unknown>): string {
  const { scope } = body;
  if (typeof scope !== "string" || scope === "") {
    throw NextlyError.validation({
      errors: [
        {
          path: "scope",
          code: "INVALID_VALUE",
          message:
            '"scope" must be the string returned by GET /api/dashboard/layout.',
        },
      ],
    });
  }
  return scope;
}

/**
 * Authenticate a WRITE to the layout, and refuse the callers who may never make
 * one.
 *
 * Shared by both mutating verbs because they share the reason, not merely the
 * code. Two copies of a precondition agree until one is edited, and the edit
 * that matters here is the one that relaxes it — an api-key refusal present on
 * the save and absent from the reset would let a key discard its minter's
 * arrangement while being unable to change it.
 *
 * 🔴 Refuses BEFORE the body is read, and before anything is parsed, resolved
 * or constructed. This is a precondition, not a defensive check: a caller that
 * can never perform the operation must be refused on that ground, and refused
 * first. Placed after the body, a malformed payload came back as a validation
 * error — telling a caller which FIELD it got wrong on a request it was never
 * allowed to make, and paying for the parse in order to say so.
 *
 * A dashboard arrangement is one person's personalization of their own admin
 * screen, and an API key has no screen. Refused rather than gated behind a
 * permission slug, because no grant would make it meaningful: the key would be
 * acting on the layout of whoever minted it. Reading stays open — it tells a
 * key nothing it could not already ask the registry.
 *
 * Read off the AUTH CONTEXT rather than the resolved caller, because that is
 * available here and the resolved caller is not: resolving one is a database
 * read, which is exactly the work this refusal exists to avoid doing.
 */
async function authenticateLayoutWrite(
  req: Request,
  intent: string
): Promise<AuthContext> {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  if (auth.authMethod === "api-key") {
    throw NextlyError.forbidden({
      logContext: { reason: `an api key may not ${intent} a dashboard layout` },
    });
  }
  return auth;
}

export const putWidgetLayout = withErrorHandler(async (req: Request) => {
  const auth = await authenticateLayoutWrite(req, "write");

  // Bounded BEFORE it is buffered. `req.json()` reads the whole body first, so
  // a quota checked on the parsed result has already paid for the memory and
  // the parse it exists to prevent. The cap is the caller's own payload budget
  // plus a small allowance for the envelope's other fields, so a body this
  // reader accepts is one `layoutSizeProblem` can still refuse on its merits.
  const body = await readBoundedJsonBody(req, MAX_LAYOUT_BYTES + 1024);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "",
          code: "INVALID_VALUE",
          message: "Body must be { placements: Placement[], version: number }.",
        },
      ],
    });
  }
  const submitted = readPlacements(
    (body as Record<string, unknown>).placements
  );
  const expectedVersion = readVersion(body as Record<string, unknown>);
  const submittedScope = readScope(body as Record<string, unknown>);

  // The caller's own quota, asked HERE — before the service, the role-slug
  // resolution, the permission decisions and the stored row. It is a
  // precondition and it is cheap, so nothing it protects should be paid for
  // first. It measures only what the caller sent, so the answer depends on
  // nothing hidden from them.
  const tooLarge = layoutSizeProblem(submitted);
  if (tooLarge !== undefined) {
    throw NextlyError.validation({
      errors: [{ path: "placements", code: "TOO_LARGE", message: tooLarge }],
    });
  }

  const service = await getLayoutService();
  const caller = readAccessCaller(await readCaller(auth));
  const widgets = await visibleWidgets(caller);
  const visibleIds = new Set(widgets.map(widget => widget.id));

  // 🔴 BEFORE the per-placement checks below, and before the write. The row's
  // `version` guards the row; this guards the FILTER that shaped what the
  // client was shown. Without it, a placement that was invisible when the
  // client read and is visible now sits in neither the submission nor the
  // carried-through set, and the write deletes it -- with `version` matching,
  // because a permission grant does not touch the row.
  //
  // It also turns the opposite case into the right refusal: a placement that
  // has just become INVISIBLE would otherwise be rejected below as naming an
  // unavailable widget, telling the client its body is malformed when what it
  // actually holds is a stale view.
  const scope = visibilityToken(widgets.map(widget => widget.id));
  if (submittedScope !== scope) {
    throw NextlyError.conflict({
      reason: "state",
      message:
        "The widgets available to you changed since you loaded the dashboard. Reload and try again.",
    });
  }

  // Refused rather than silently dropped. A placement naming a widget this
  // caller cannot see is not a stale client -- the client was handed a filtered
  // list and is sending back something that was never in it. Accepting it would
  // let any authenticated caller confirm a widget's existence by watching which
  // ids survive a round trip, which is the same oracle the query endpoint
  // collapses its two dead ends to avoid.
  const foreign = submitted.find(
    placement => !visibleIds.has(placement.widgetId)
  );
  if (foreign) {
    throw NextlyError.validation({
      errors: [
        {
          path: "placements",
          code: "INVALID_VALUE",
          message: `No widget is available under "${foreign.widgetId}".`,
        },
      ],
    });
  }

  const duplicate = firstDuplicateId(submitted);
  if (duplicate !== undefined) {
    throw NextlyError.validation({
      errors: [
        {
          path: "placements",
          code: "INVALID_VALUE",
          message: `Placement id "${duplicate}" appears more than once.`,
        },
      ],
    });
  }

  const stored = await service.getLayout(SCOPE_KIND, caller.userId);
  const carried = carriedPlacements(stored.layout?.placements, visibleIds);

  const toStore = mergePreservingHidden(submitted, carried);
  const version = await service.saveLayout(
    SCOPE_KIND,
    caller.userId,
    toStore,
    expectedVersion
  );

  // `respondMutation`, not `respondData`: this is a write, and every write in
  // this package answers `{ message, item }`. A bespoke top-level shape would
  // be one the shared client parser cannot read at all.
  // Sorted the way a GET sorts, not echoed in submission order. A valid PUT may
  // list placements in any array order — only each `order` field is validated —
  // and the stored row is normalized by `partitionPlacements` on the next read.
  // Echoing the raw array made this response a SECOND representation of the
  // same arrangement: a client trusting it to chain another edit without
  // re-reading would render `[10, 0]` where a reload gives `[0, 10]`.
  const echoed = [...submitted].sort((a, b) => a.order - b.order);

  return respondMutation(
    "Dashboard layout saved.",
    {
      placements: echoed,
      version,
      source: "own" satisfies LayoutSource,
      // Echoed so a client can make a second edit without a round trip. It is
      // the token this write was checked against, which is still current: any
      // change to it since would have to have happened during the write, and
      // the next PUT will catch that on its own terms.
      scope,
    },
    { headers: OPAQUE_CONFIG_HEADERS }
  );
});

/** The first placement id used twice, or `undefined`. */
function firstDuplicateId(
  placements: readonly WidgetPlacement[]
): string | undefined {
  const seen = new Set<string>();
  for (const placement of placements) {
    if (seen.has(placement.id)) return placement.id;
    seen.add(placement.id);
  }
  return undefined;
}

/**
 * DELETE `/api/dashboard/layout` — put the dashboard back to the registry's
 * own order.
 *
 * Removes the row rather than writing the current defaults into it, and the
 * difference is the whole point. A written snapshot freezes today's defaults
 * into the reader's arrangement, so a widget added later, or a `defaultOrder`
 * a plugin changes later, never reaches them again — the reader would be
 * "reset" onto a layout that stops tracking the thing it was reset to. With no
 * row, resolution falls through to the live registry on every read, which is
 * what a default IS.
 *
 * Refused for an API key on the same ground as the write: a dashboard
 * arrangement belongs to a person, and a key resetting one would be discarding
 * its minter's.
 */
export const deleteWidgetLayout = withErrorHandler(async (req: Request) => {
  const auth = await authenticateLayoutWrite(req, "reset");

  const service = await getLayoutService();
  const caller = readAccessCaller(await readCaller(auth));
  await service.deleteLayout(SCOPE_KIND, caller.userId);

  // No version echoed, because there is no row to hold one: the next read
  // answers 0 and `source: "default"`, which is the state the caller asked to
  // be in. Returning a version here would hand a client a number to send back
  // in a guard that now has nothing to guard.
  return respondAction(
    "Dashboard layout reset.",
    {},
    {
      headers: OPAQUE_CONFIG_HEADERS,
    }
  );
});
