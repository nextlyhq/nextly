/**
 * GET / PUT `/api/dashboard/layout`
 *
 * One reader's arrangement of the dashboard: which cards, in which order, at
 * which width, and which they have removed.
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

import type { AuthContext } from "../auth/middleware";
import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import { addPanelFacts, inAddPanelOrder } from "../domains/widgets/add-panel";
import {
  declaredWidgets,
  widthFacts,
  type CanonicalWidget,
  type WidgetWidthFacts,
} from "../domains/widgets/canonical";
import { widgetsWhoseConditionHolds } from "../domains/widgets/conditions";
import {
  MAX_LAYOUT_BYTES,
  MAX_PLACEMENTS,
  defaultPlacements,
  dismissalsApplied,
  layoutIsArranged,
  resolvePlacementIds,
  layoutSizeProblem,
  mergePreservingHidden,
  partitionPlacements,
  readPlacements,
  visibilityToken,
  type StoredLayout,
  type WidgetPlacement,
} from "../domains/widgets/layout";
import { widgetAudience } from "../domains/widgets/visibility";
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

/**
 * Which arrangement the reader was handed.
 *
 * `unreadable` is a stored row that could not be read: the reader is shown the
 * default, told so, and the row is left exactly as it was until they confirm a
 * save that replaces it.
 */
type LayoutSource = "own" | "default" | "unreadable";

/** A declared widget as the default arrangement reads it. */
function placeable(widget: CanonicalWidget) {
  return {
    id: widget.id,
    ...(widget.defaultOrder === undefined
      ? {}
      : { defaultOrder: widget.defaultOrder }),
    defaultWidth: widthFacts(widget).defaultWidth,
  };
}

/**
 * The whole arrangement a reader without an arranged row follows: the one
 * computed default, with their removals applied.
 *
 * ONE materialization over every declared widget, split afterwards, so the
 * cards a caller may see and the ones they may not keep one order between
 * them. Materialized from {@link declaredWidgets} rather than from every
 * widget that exists: a card core GENERATED for a collection is offered
 * through `available`, never placed.
 *
 * A row nobody arranged contributes its removals and nothing else, applied to
 * the WHOLE materialization, so a card this caller cannot see keeps the
 * removal it was given, and comes back removed the day they can.
 */
function followedDefault(unarranged?: StoredLayout): WidgetPlacement[] {
  return dismissalsApplied(
    defaultPlacements(declaredWidgets().map(placeable)),
    unarranged
  );
}

/**
 * The WHOLE arrangement this caller's view was cut from: their arranged row,
 * or the default they follow. Both what a reader is shown and what a writer
 * carries back come from this, so the two cannot disagree.
 *
 * 🔴 With no arranged row, the caller was still shown a FILTERED default, so
 * a first save must carry the default's cards they could not see into the row,
 * in place. Otherwise a permission granted after that save could never bring
 * them back: the default is consulted only while the reader follows it.
 */
function wholeArrangement(stored: StoredLayout | undefined): WidgetPlacement[] {
  return stored && layoutIsArranged(stored)
    ? stored.placements
    : followedDefault(stored);
}

/**
 * The arrangement this caller was HANDED, in order.
 *
 * 🔴 A row EXISTING is not enough to honour it as a snapshot. A row a removal
 * outside customise mode wrote has never been arranged, and honouring it would
 * freeze that reader out of every widget declared afterwards.
 *
 * The visible half of a FOLLOWED default is capped at `MAX_PLACEMENTS`, the
 * most a caller may submit, so an install declaring more than that still
 * answers with a dashboard the reader's first save can store. Capped after the
 * split, never before: the whole set includes widgets this caller may not know
 * exist, and capping it first let them exhaust the allowance. The surplus is
 * offered through `available`.
 */
function visibleArrangement(
  stored: StoredLayout | undefined,
  visibleIds: ReadonlySet<string>
): WidgetPlacement[] {
  const { visible } = partitionPlacements(wholeArrangement(stored), visibleIds);
  return stored && layoutIsArranged(stored)
    ? visible
    : visible.slice(0, MAX_PLACEMENTS);
}

/**
 * Each widget this reader may see, with the widths its cards may take.
 *
 * Sent so the admin never works a width out for itself: which widths to offer,
 * where a new card starts, and whether a second card may be added are answered
 * here, from the one reading of the declaration (`widthFacts`).
 */
function widthsOf(
  widgets: readonly CanonicalWidget[]
): Record<string, WidgetWidthFacts> {
  return Object.fromEntries(
    widgets.map(widget => [widget.id, widthFacts(widget)])
  );
}

/**
 * Each widget this reader may see, as the dashboard and its add panel need it:
 * the widths its cards may take, and where the panel lists it (group,
 * sub-group, description, category and sketch kind).
 *
 * The group is core's to assign, so the admin never works one out for itself;
 * {@link addPanelFacts} is the one place it is decided.
 */
function widgetFactsOf(widgets: readonly CanonicalWidget[]) {
  // Each offered widget's place in the panel's order, by the rule that orders
  // `available`, so the panel can list a placed widget (as "on dashboard")
  // where it would be offered, without ordering anything itself.
  const rank = new Map(
    inAddPanelOrder(widgets).map((widget, index) => [widget.id, index])
  );
  return Object.fromEntries(
    widgets.map(widget => {
      const facts = addPanelFacts(widget);
      return [
        widget.id,
        {
          ...widthFacts(widget),
          ...(facts === undefined
            ? {}
            : { ...facts, rank: rank.get(widget.id) }),
        },
      ];
    })
  );
}

/**
 * The scope a layout belongs to today.
 *
 * Every row this endpoint writes is the caller's own, so there is exactly one
 * scope kind to resolve. The key reserves the dimension anyway: a second kind
 * of owner added after rows exist is a migration, and reserving one column now
 * costs nothing.
 */
const SCOPE_KIND = "user" as const;

async function getLayoutService(): Promise<WidgetLayoutService> {
  await getCachedNextly();
  return container.get<WidgetLayoutService>("widgetLayoutService");
}

/**
 * The widgets this caller may see right now, and the token over them.
 *
 * 🔴 The SAME two passes for every verb, in the same order. The token is a hash
 * of the set the client was shown, so a write that derived it from a
 * different set could never match. The first pass, the permission gate,
 * decides what this reader may be told exists; the second decides which
 * transient cards are worth showing now, and a lapsed card is not a refusal.
 */
async function visibleWidgets(auth: AuthContext) {
  const reader = await readCaller(auth);
  const caller = readAccessCaller(reader);
  const audience = await widgetAudience(caller);
  const widgets = await widgetsWhoseConditionHolds(audience.visible, reader);
  return {
    caller,
    audience,
    widgets,
    visibleIds: new Set(widgets.map(widget => widget.id)),
    scope: visibilityToken(
      widgets.map(widget => widget.id),
      audience.heldActionGates
    ),
  };
}

/**
 * The cards this caller was handed, by card id: exactly what a by-card query
 * may ask for, and nothing else.
 *
 * 🔴 Read by the same two passes and the same arrangement the layout read
 * takes ({@link visibleWidgets}, {@link visibleArrangement}), so a card the
 * reader was never shown -- another person's, a widget they may not see, one
 * they removed -- is simply not here, and the query endpoint cannot answer it
 * differently from the dashboard that drew it.
 */
export async function handedCards(
  auth: AuthContext
): Promise<ReadonlyMap<string, WidgetPlacement>> {
  const service = await getLayoutService();
  const view = await visibleWidgets(auth);
  const stored = await service.getLayout(SCOPE_KIND, view.caller.userId);
  return new Map(
    visibleArrangement(stored.layout, view.visibleIds)
      .filter(placement => placement.removed !== true)
      .map(placement => [placement.id, placement])
  );
}

/**
 * The version the client must echo back.
 *
 * An unreadable row keeps its real version rather than reporting 0. Reporting 0
 * would tell the client "there is no row", and its next PUT would take the
 * INSERT path and collide with the row that is still sitting there -- turning a
 * recoverable bad row into a dashboard that cannot be saved at all.
 */
export const getWidgetLayout = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  const service = await getLayoutService();
  const view = await visibleWidgets(auth);
  const stored = await service.getLayout(SCOPE_KIND, view.caller.userId);

  const source: LayoutSource = stored.unreadable
    ? "unreadable"
    : stored.layout
      ? "own"
      : "default";
  const placements = visibleArrangement(stored.layout, view.visibleIds);
  const widths = widthsOf(view.widgets);

  // Widgets this caller may see and may still add. A saved arrangement is a
  // full snapshot, so a widget registered after the reader last saved appears
  // nowhere in `placements` -- a new plugin's card is never inserted into
  // somebody's arrangement behind their back. It is OFFERED here instead, and
  // so is any widget that allows several cards, placed or not.
  //
  // Ids only. Titles and icons already reach the admin through the widget
  // metadata it renders from; what only this endpoint can answer is WHICH of
  // them this caller is allowed to know about. In the add panel's order, so
  // the panel lists them as sent.
  const placed = new Set(placements.map(placement => placement.widgetId));
  const available = inAddPanelOrder(
    view.widgets.filter(
      widget => !placed.has(widget.id) || widths[widget.id].allowsSeveral
    )
  ).map(widget => widget.id);

  return respondData(
    {
      placements,
      // The default as this reader would see it, from the same computation a
      // reader following it is shown: a staged reset draws it, and the admin
      // never works the default out for itself.
      defaultPlacements: visibleArrangement(undefined, view.visibleIds),
      widgets: widgetFactsOf(view.widgets),
      available,
      version: stored.version,
      source,
      scope: view.scope,
      // The audience the workspace payload is built for, so the admin can tell
      // the payload it holds apart from the one this reader would be sent now.
      audience: view.audience.token,
    },
    { headers: OPAQUE_CONFIG_HEADERS }
  );
});

/**
 * Reads the `version` a write is guarded by.
 *
 * A non-integer is refused rather than coerced. `Number("")` is 0, which is the
 * "there is no row yet" version -- so a client that omitted the field, or sent
 * an empty string, would be read as asserting the row does not exist.
 */
function readVersion(version: unknown): number {
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
 * Reads an OPTIONAL boolean field, refusing anything but a boolean when it is
 * present: `"false"` read for truthiness would mean the opposite of what it
 * says.
 */
function readOptionalBoolean(
  body: Record<string, unknown>,
  field: string,
  absent: boolean
): boolean {
  const value = body[field];
  if (value === undefined) return absent;
  if (typeof value !== "boolean") {
    throw NextlyError.validation({
      errors: [
        {
          path: field,
          code: "INVALID_VALUE",
          message: `"${field}", when given, must be a boolean.`,
        },
      ],
    });
  }
  return value;
}

/**
 * Reads the visibility token a write must echo.
 *
 * Required, not optional. An optional token would be absent for every client
 * that has not been updated -- which is every client that has the bug this
 * token exists to prevent.
 */
function readScope(scope: unknown): string {
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
 * Refuses a write whose view of the widgets is stale.
 *
 * 🔴 The row's `version` guards the row; this guards the FILTER that shaped
 * what the client was shown. Without it, a card that was invisible when the
 * client read and is visible now sits in neither the submission nor the
 * carried set, and a save deletes it -- with `version` matching, because a
 * permission grant does not touch the row. A saved reset would remove it the
 * same way. Checked before anything the write would change.
 */
function refuseStaleScope(submitted: string, current: string): void {
  if (submitted !== current) {
    throw NextlyError.conflict({
      reason: "state",
      message:
        "The widgets available to you changed since you loaded the dashboard. Reload and try again.",
    });
  }
}

/**
 * Authenticate a WRITE to the layout, and refuse the callers who may never make
 * one.
 *
 * Shared by both mutating verbs because they share the reason, not merely the
 * code: an api-key refusal present on the save and absent from the reset would
 * let a key discard its minter's arrangement while being unable to change it.
 *
 * 🔴 Refuses BEFORE the body is read, and before anything is parsed, resolved
 * or constructed. A dashboard arrangement is one person's personalization of
 * their own admin screen, and an API key has no screen. Reading stays open.
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

/** Refuses a submission naming a widget this caller may not see, or an id twice. */
function refuseUnknownOrRepeated(
  submitted: readonly WidgetPlacement[],
  visibleIds: ReadonlySet<string>
): void {
  // Refused rather than silently dropped. A placement naming a widget this
  // caller cannot see was never in what they were handed; accepting it would
  // let any caller confirm a widget's existence by watching which ids survive.
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

  const { duplicate } = resolvePlacementIds(submitted);
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
}

/**
 * Refuses a card SET to a width its widget does not allow.
 *
 * 🔴 Only a width that CHANGED. A stored width the widget has since stopped
 * allowing is kept on purpose (it is drawn at the nearest allowed width, and
 * comes back if the widget allows it again), so a card the reader did not
 * touch must save as it was; refusing it would make an unrelated change to the
 * dashboard impossible to save. The baseline is what this caller was shown.
 */
function refuseDisallowedWidths(
  submitted: readonly WidgetPlacement[],
  shown: readonly WidgetPlacement[],
  widths: Readonly<Record<string, WidgetWidthFacts>>
): void {
  // Unchanged means the SAME card: same id, same widget, same width. A card
  // whose id now names a different widget is a new card, and its width is
  // judged against the widget it now draws.
  const shownById = new Map(shown.map(p => [p.id, p]));
  const unchanged = (placement: WidgetPlacement) => {
    const before = shownById.get(placement.id);
    return (
      before !== undefined &&
      before.widgetId === placement.widgetId &&
      before.width === placement.width
    );
  };
  const refused = submitted.find(
    placement =>
      !unchanged(placement) &&
      !widths[placement.widgetId]?.allowedWidths.includes(placement.width)
  );
  if (refused) {
    throw NextlyError.validation({
      errors: [
        {
          path: "placements",
          code: "INVALID_VALUE",
          message: `"${refused.widgetId}" does not allow the width "${refused.width}".`,
        },
      ],
    });
  }
}

/**
 * Refuses a second card of a widget that allows one.
 *
 * Counted against what the caller was SHOWN, so an arrangement that already
 * held more than one card of such a widget (rows written before widgets said
 * how many they allow) can still be saved as it is; only a card ADDED beyond
 * the widget's allowance is refused.
 */
function refuseExtraCards(
  submitted: readonly WidgetPlacement[],
  shown: readonly WidgetPlacement[],
  widths: Readonly<Record<string, WidgetWidthFacts>>
): void {
  const count = (placements: readonly WidgetPlacement[]) => {
    const counts = new Map<string, number>();
    for (const p of placements) {
      counts.set(p.widgetId, (counts.get(p.widgetId) ?? 0) + 1);
    }
    return counts;
  };
  const shownCounts = count(shown);
  for (const [widgetId, cards] of count(submitted)) {
    if (widths[widgetId]?.allowsSeveral) continue;
    if (cards > Math.max(1, shownCounts.get(widgetId) ?? 0)) {
      throw NextlyError.validation({
        errors: [
          {
            path: "placements",
            code: "INVALID_VALUE",
            message: `"${widgetId}" allows one card on a dashboard.`,
          },
        ],
      });
    }
  }
}

/**
 * Refuses a write that would replace an arrangement the server could not read,
 * unless the person confirmed exactly that.
 *
 * 🔴 The read never touches an unreadable row, and neither does a write the
 * person did not confirm. A single-card write (a removal outside customise
 * mode) is refused outright: it has nothing to merge into, and replacing the
 * row is only ever a confirmed save. A save must say `replaceUnreadable: true`,
 * which the admin sends only after asking. Enforced here, not left to the
 * admin, so no client can overwrite the row by forgetting to ask.
 */
function refuseUnconfirmedReplacement(
  unreadable: boolean,
  arranges: boolean,
  confirmed: boolean
): void {
  if (!unreadable || (arranges && confirmed)) return;
  throw NextlyError.conflict({
    reason: "state",
    logContext: { storedLayout: "unreadable" },
    message: arranges
      ? "Your saved dashboard could not be loaded. Saving replaces it; confirm to save."
      : "Your saved dashboard could not be loaded. Save it from customise mode first.",
  });
}

export const putWidgetLayout = withErrorHandler(async (req: Request) => {
  const auth = await authenticateLayoutWrite(req, "write");

  // Bounded BEFORE it is buffered. The cap is the caller's own payload budget
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
  const fields = body as Record<string, unknown>;
  // An earlier format's body has no width and no removed flag, and is refused
  // here by the same rules a stored row is read with.
  const submitted = readPlacements(fields.placements);
  const expectedVersion = readVersion(fields.version);
  const submittedScope = readScope(fields.scope);
  // OPTIONAL, and absent reads as `true`: every save from customise mode is an
  // arrangement, and the one write that is not -- a removal outside it -- is
  // new enough to say so.
  const writeArranges = readOptionalBoolean(fields, "arranged", true);
  const replaceUnreadable = readOptionalBoolean(
    fields,
    "replaceUnreadable",
    false
  );

  // The caller's own quota, asked HERE, before anything it protects is paid
  // for. It measures only what the caller sent.
  const tooLarge = layoutSizeProblem(submitted);
  if (tooLarge !== undefined) {
    throw NextlyError.validation({
      errors: [{ path: "placements", code: "TOO_LARGE", message: tooLarge }],
    });
  }

  const service = await getLayoutService();
  const view = await visibleWidgets(auth);
  refuseStaleScope(submittedScope, view.scope);
  refuseUnknownOrRepeated(submitted, view.visibleIds);

  const stored = await service.getLayout(SCOPE_KIND, view.caller.userId);
  refuseUnconfirmedReplacement(
    stored.unreadable,
    writeArranges,
    replaceUnreadable
  );
  const shown = visibleArrangement(stored.layout, view.visibleIds);
  const widths = widthsOf(view.widgets);
  refuseDisallowedWidths(submitted, shown, widths);
  refuseExtraCards(submitted, shown, widths);

  // 🔴 MONOTONIC. A row a reader has arranged stays arranged whatever a later
  // write says: a removal outside customise mode states `false` because IT is
  // not an arrangement, and taking that at its word would demote a reader's
  // own layout to the default and discard every move they ever made.
  const arranged =
    writeArranges ||
    (stored.layout !== undefined && layoutIsArranged(stored.layout));

  const version = await service.saveLayout(
    SCOPE_KIND,
    view.caller.userId,
    mergePreservingHidden(
      submitted,
      wholeArrangement(stored.layout),
      view.visibleIds
    ),
    expectedVersion,
    arranged
  );

  // `respondMutation`, not `respondData`: every write in this package answers
  // `{ message, item }`. The placements are echoed in the order they were
  // stored, which is the order the next read answers.
  return respondMutation(
    "Dashboard layout saved.",
    {
      placements: submitted,
      version,
      source: "own" satisfies LayoutSource,
      // The token this write was checked against, which is still current.
      scope: view.scope,
    },
    { headers: OPAQUE_CONFIG_HEADERS }
  );
});

/**
 * DELETE `/api/dashboard/layout?version=<n>&scope=<token>` -- return the reader
 * to the default dashboard.
 *
 * Removes the row rather than writing the current default into it: a written
 * snapshot would freeze today's default into the reader's arrangement, and a
 * later change to the default would never reach them. With no row, every read
 * computes the default afresh, which is what following it means.
 *
 * 🔴 Guarded like a save. A reset is staged in one tab and saved later; the
 * version and visibility token it was staged against travel with it, and the
 * delete is refused as a conflict, removing nothing, when either has moved --
 * so a stale tab cannot delete an arrangement another tab saved, cards it never
 * saw included. Query parameters rather than a body, because a DELETE body is
 * one some clients and proxies drop.
 *
 * Refused for an API key on the same ground as the write.
 */
export const deleteWidgetLayout = withErrorHandler(async (req: Request) => {
  const auth = await authenticateLayoutWrite(req, "reset");

  const query = new URL(req.url).searchParams;
  const rawVersion = query.get("version");
  const expectedVersion = readVersion(
    rawVersion !== null && /^\d+$/.test(rawVersion)
      ? Number(rawVersion)
      : rawVersion
  );
  const submittedScope = readScope(query.get("scope") ?? undefined);

  const service = await getLayoutService();
  const view = await visibleWidgets(auth);
  refuseStaleScope(submittedScope, view.scope);
  await service.deleteLayout(SCOPE_KIND, view.caller.userId, expectedVersion);

  // No version echoed, because there is no row to hold one: the next read
  // answers 0 and `source: "default"`, which is the state the caller asked for.
  return respondAction(
    "Dashboard layout reset.",
    {},
    {
      headers: OPAQUE_CONFIG_HEADERS,
    }
  );
});
