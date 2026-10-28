/**
 * GET / PUT `/api/dashboard/layout`
 *
 * One reader's arrangement of the dashboard: which cards, in which order, at
 * which size, and which they have removed.
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
  allWidgets,
  sizeFacts,
  type CanonicalWidget,
  type WidgetSizeFacts,
} from "../domains/widgets/canonical";
import {
  collectionSettingsToken,
  collectionWidgets,
  unreadableCollectionCard,
} from "../domains/widgets/collection-cards";
import { conditionProbe } from "../domains/widgets/condition-probe";
import { widgetsWhoseConditionHolds } from "../domains/widgets/conditions";
import { defaultLayoutPlacements } from "../domains/widgets/default-layout";
import {
  getStartedDrawn,
  getStartedPlacement,
  getStartedView,
  withoutDormantCard,
} from "../domains/widgets/get-started-card";
import { GET_STARTED_WIDGET_ID } from "../domains/widgets/get-started-steps";
import {
  LAYOUT_SCHEMA_VERSION,
  MAX_LAYOUT_BYTES,
  MAX_PLACEMENTS,
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
import { retiredWidgetReplacement } from "../domains/widgets/retired-widget-namespaces";
import type { TextBound } from "../domains/widgets/settings";
import { widgetAudience } from "../domains/widgets/visibility";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import type { ReadCaller } from "../services/dashboard/readable-resources";
import {
  NO_STORED_LAYOUT_VERSION,
  type WidgetLayoutService,
} from "../services/widgets/widget-layout-service";
import { textLength } from "../shared/text-length";

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

/**
 * The whole arrangement a reader without an arranged row follows: the one
 * default (`defaultLayoutPlacements`, from the site's `defaultLayout` or
 * core's, and the plugins' suggestions), with their removals applied.
 *
 * ONE materialization over every widget the install has, split afterwards, so
 * the cards a caller may see and the ones they may not keep one order between
 * them, and two people's defaults differ only by the cards each may not see.
 *
 * A row nobody arranged contributes its removals and nothing else, applied to
 * the WHOLE materialization, so a card this caller cannot see keeps the
 * removal it was given, and comes back removed the day they can.
 */
function followedDefault(unarranged?: StoredLayout): WidgetPlacement[] {
  return dismissalsApplied(defaultLayoutPlacements(allWidgets()), unarranged);
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
  view: CardView,
  notShown: ReadonlySet<string> = NOTHING_WITHHELD
): WidgetPlacement[] {
  const { visible } = partitionPlacements(
    wholeArrangement(stored),
    view.visibleIds,
    withheldFrom(stored, view, notShown)
  );
  return stored && layoutIsArranged(stored)
    ? visible
    : visible.slice(0, MAX_PLACEMENTS);
}

/** What decides which cards of an arrangement a reader is handed. */
interface CardView {
  visibleIds: ReadonlySet<string>;
  withheld: (placement: WidgetPlacement) => boolean;
}

const NOTHING_WITHHELD: ReadonlySet<string> = new Set();

/**
 * The cards withheld from what this reader is handed: those of their view,
 * and, while they follow the default, the default's cards their declared
 * widgets' own rules would not show them (`notShown`). An arranged row is
 * theirs as they arranged it, and its cards answer for themselves.
 */
function withheldFrom(
  stored: StoredLayout | undefined,
  view: CardView,
  notShown: ReadonlySet<string>
): (placement: WidgetPlacement) => boolean {
  if ((stored && layoutIsArranged(stored)) || notShown.size === 0) {
    return view.withheld;
  }
  return placement => view.withheld(placement) || notShown.has(placement.id);
}

/**
 * The cards of the default this reader would not be shown by their declared
 * widgets' own rules, among those their view lets them see: judged with the
 * default's own settings (`inDefault`, the default a reset returns to), and,
 * for a reader whose row follows the default, with the settings that row gave
 * its cards (`forReader`), since each card is drawn with those. Only a card
 * whose settings the row changed is asked again.
 *
 * Loaded lazily: that judgement is the card endpoint's, which reads this
 * module to know what a caller was handed.
 */
async function notShownInDefault(
  auth: AuthContext,
  view: CardView & { reader: ReadCaller },
  signal: AbortSignal,
  stored: StoredLayout | undefined
): Promise<{
  inDefault: ReadonlySet<string>;
  forReader: ReadonlySet<string>;
}> {
  const { defaultCardsNotShown } = await import("./default-cards-shown");
  const seen = (placements: readonly WidgetPlacement[]) =>
    placements.filter(
      placement =>
        view.visibleIds.has(placement.widgetId) && !view.withheld(placement)
    );
  const plain = seen(followedDefault());
  const inDefault = await defaultCardsNotShown(
    auth,
    view.reader,
    plain,
    signal
  );
  if (stored === undefined || layoutIsArranged(stored)) {
    return { inDefault, forReader: inDefault };
  }
  const startedAs = new Map(
    plain.map(placement => [placement.id, JSON.stringify(placement.config)])
  );
  const changed = seen(followedDefault(stored)).filter(
    placement =>
      startedAs.get(placement.id) !== JSON.stringify(placement.config)
  );
  if (changed.length === 0) return { inDefault, forReader: inDefault };
  const judgedAgain = await defaultCardsNotShown(
    auth,
    view.reader,
    changed,
    signal
  );
  const changedIds = new Set(changed.map(placement => placement.id));
  return {
    inDefault,
    forReader: new Set([
      ...[...inDefault].filter(id => !changedIds.has(id)),
      ...judgedAgain,
    ]),
  };
}

/**
 * The default's cards withheld from what this reader was handed, and the
 * token their write is checked against: none for an arranged row, whose cards
 * answer for themselves.
 */
async function readerCards(
  auth: AuthContext,
  view: Awaited<ReturnType<typeof visibleWidgets>>,
  stored: StoredLayout | undefined,
  signal: AbortSignal
): Promise<{ notShown: ReadonlySet<string>; scope: string }> {
  const notShown =
    stored && layoutIsArranged(stored)
      ? NOTHING_WITHHELD
      : (await notShownInDefault(auth, view, signal, stored)).forReader;
  return { notShown, scope: view.scopeWith(notShown) };
}

/**
 * Each widget this reader may see, with its size facts: the bounds its cards
 * start and are kept within, and whether a dashboard may hold more than one,
 * from the one reading of the declaration (`sizeFacts`).
 */
function sizesOf(
  widgets: readonly CanonicalWidget[]
): Record<string, WidgetSizeFacts> {
  return Object.fromEntries(
    widgets.map(widget => [widget.id, sizeFacts(widget)])
  );
}

/**
 * Each widget this reader may see, as the dashboard and its add panel need it:
 * whether a second card of it may be added, and where the panel lists it
 * (group, sub-group, description, category and sketch kind).
 *
 * Not its size bounds: the admin reads those from the widget's declaration,
 * which it already holds, so a second copy here could only disagree with it.
 *
 * The group is core's to assign, so the admin never works one out for itself;
 * {@link addPanelFacts} is the one place it is decided.
 */
function widgetFactsOf(widgets: readonly CanonicalWidget[]) {
  // Each widget's place in the panel's order, by the rule that orders
  // `available`, so the panel can list a placed widget (as "on dashboard")
  // where it would be offered, without ordering anything itself. Every
  // widget has one: the panel offers each widget the install declares.
  const rank = new Map(
    inAddPanelOrder(widgets).map((widget, index) => [widget.id, index])
  );
  return Object.fromEntries(
    widgets.map(widget => {
      return [
        widget.id,
        {
          allowsSeveral: sizeFacts(widget).allowsSeveral,
          ...addPanelFacts(widget),
          rank: rank.get(widget.id),
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
 *
 * The probe the conditions read through is returned, so the Get started steps
 * share its reads rather than resolving the same collections again.
 */
async function visibleWidgets(auth: AuthContext) {
  const reader = await readCaller(auth);
  const caller = readAccessCaller(reader);
  const audience = await widgetAudience(caller);
  const probe = conditionProbe(reader);
  const widgets = await widgetsWhoseConditionHolds(
    audience.visible,
    reader,
    probe
  );
  // The collections this reader may read, from the refresh the audience pass
  // just ran: asked of every collection a card may be set to, the one answer
  // the withheld cards and the scope are both taken from.
  const readable = audience.readableCollections;
  return {
    caller,
    reader,
    audience,
    probe,
    widgets,
    visibleIds: new Set(widgets.map(widget => widget.id)),
    // A card set to a collection this reader may not read, withheld as a card
    // of a widget they may not see is, judged by the Collection setting the
    // canonical summary carries from either channel.
    withheld: unreadableCollectionCard(collectionWidgets(widgets), readable),
    // Over everything that decides what is withheld: the widgets, the gates,
    // the collections this reader may read, and each Collection setting's
    // default, which decides a card that stores no value.
    scope: scopeOver([]),
    // The same token over the default's cards a reader following it is not
    // shown (`notShown`), which every verb asks of a reader with no arranged
    // row: none withheld gives `scope` itself.
    scopeWith: scopeOver,
  };

  function scopeOver(notShown: Iterable<string>): string {
    return visibilityToken(
      widgets.map(widget => widget.id),
      audience.heldActionGates,
      readable,
      collectionSettingsToken(widgets),
      notShown
    );
  }
}

/**
 * The cards this caller was handed, by card id: exactly what a by-card query
 * may ask for, and nothing else; and the widgets they could place a card of,
 * which a card not yet saved, or a settings preview, may be asked for.
 *
 * 🔴 Read by the same two passes and the same arrangement the layout read
 * takes ({@link visibleWidgets}, {@link visibleArrangement}), so a card the
 * reader was never shown -- another person's, a widget they may not see, one
 * they removed -- is simply not here, and the query endpoint cannot answer it
 * differently from the dashboard that drew it.
 */
export async function askableCards(auth: AuthContext): Promise<{
  handed: ReadonlyMap<string, WidgetPlacement>;
  placeable: ReadonlySet<string>;
}> {
  const service = await getLayoutService();
  const view = await visibleWidgets(auth);
  const stored = await service.getLayout(SCOPE_KIND, view.caller.userId);
  return {
    handed: new Map(
      visibleArrangement(stored.layout, view)
        .filter(placement => placement.removed !== true)
        .map(placement => [placement.id, placement])
    ),
    // 🔴 The layout write's own gate (`putWidgetLayout` refuses a placement of
    // any widget outside it, and `authenticateLayoutWrite` refuses an API key
    // outright), so a widget whose card may be previewed with settings of the
    // reader's choosing is exactly one they could place. A key has no admin
    // screen to place a card on, so it may preview none.
    placeable: mayWriteLayout(auth) ? view.visibleIds : new Set<string>(),
  };
}

/**
 * Whether this caller may write a dashboard layout at all: a person signed in
 * to the admin, never an API key. One rule for the write and for the previews
 * that stand in for one.
 */
function mayWriteLayout(auth: AuthContext): boolean {
  return auth.authMethod !== "api-key";
}

/**
 * The version the client must echo back.
 *
 * An unreadable row keeps its real version rather than reporting 0, and so
 * does a row of an earlier format, which is read as no saved arrangement.
 * Reporting 0 would tell the client "there is no row", and its next PUT would
 * take the INSERT path and collide with the row that is still sitting there --
 * turning a recoverable bad row, or a reset one, into a dashboard that cannot
 * be saved at all.
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
  // Judged for every read, since the default below is handed to a reader
  // with an arrangement of their own too, as the dashboard a reset returns to.
  const judged = await notShownInDefault(auth, view, req.signal, stored.layout);
  const arranged =
    stored.layout !== undefined && layoutIsArranged(stored.layout);
  const notShown = arranged ? NOTHING_WITHHELD : judged.forReader;
  const arrangement = visibleArrangement(stored.layout, view, notShown);
  // The Get started card is drawn or left dormant from its step answer and its
  // own settings, which is why this is decided here, after the row is read,
  // and not by a condition before it. `?getStarted=1` asks for the answer of a
  // removed card, which the admin needs as it restores one.
  const askedForSteps = new URL(req.url).searchParams.get("getStarted") === "1";
  const getStarted = await getStartedView(
    view.probe,
    getStartedPlacement(arrangement),
    askedForSteps
  );
  const placements = withoutDormantCard(arrangement, () => getStarted.drawn);
  // The default as a reader following it would be handed it: their card has
  // no settings yet, so it is drawn from the answer alone. The steps are
  // worked out when this read worked them out, or when the admin asks
  // (`?getStarted=1`), as it does before staging a reset: an arrangement with
  // no card of its own still resets onto a default that may draw one.
  const steps =
    getStarted.answer === null && !askedForSteps
      ? null
      : await view.probe.getStarted();
  const defaults = withoutDormantCard(
    visibleArrangement(undefined, view, judged.inDefault),
    card => steps !== null && getStartedDrawn(steps, card.config)
  );
  const sizes = sizesOf(view.widgets);

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
  //
  // Never Get started: it is offered back only from Removed, as the card the
  // reader removed, with its progress and skips.
  const placed = new Set(placements.map(placement => placement.widgetId));
  const available = inAddPanelOrder(
    view.widgets.filter(
      widget =>
        widget.id !== GET_STARTED_WIDGET_ID &&
        (!placed.has(widget.id) || sizes[widget.id].allowsSeveral)
    )
  ).map(widget => widget.id);

  return respondData(
    {
      placements,
      // The default as this reader would see it, from the same computation a
      // reader following it is shown: a staged reset draws it, and the admin
      // never works the default out for itself.
      defaultPlacements: defaults,
      widgets: widgetFactsOf(view.widgets),
      available,
      version: stored.version,
      source,
      // Over the cards withheld from what they were handed, so a save staged
      // before one of those verdicts changed is refused rather than dropping
      // a card it never held.
      scope: view.scopeWith(notShown),
      // The audience the workspace payload is built for, so the admin can tell
      // the payload it holds apart from the one this reader would be sent now.
      audience: view.audience.token,
      // The Get started steps, from the computation that decided whether the
      // card is drawn, so the card and its steps cannot disagree.
      getStarted,
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

  if (!mayWriteLayout(auth)) {
    throw NextlyError.personOnly({
      doing: "change a dashboard layout",
      logContext: { reason: `an api key may not ${intent} a dashboard layout` },
    });
  }
  return auth;
}

/**
 * Refuses a submitted card set to a collection this reader may not read.
 *
 * 🔴 One answer whether the collection exists or not: a write that failed for
 * one and was stored for the other would tell a reader which names exist. And
 * none is stored, so no card the reader was never allowed to see enters their
 * row. A card they already held is not in their submission once withheld: it
 * is carried, not resubmitted.
 */
function refuseUnreadableCollections(
  submitted: readonly WidgetPlacement[],
  withheld: (placement: WidgetPlacement) => boolean
): void {
  if (!submitted.some(withheld)) return;
  throw NextlyError.validation({
    errors: [
      {
        path: "placements",
        code: "INVALID_VALUE",
        message: "A card is set to a collection that is not available.",
      },
    ],
  });
}

/**
 * Refuses a submission naming a widget this caller may not see, a card of a
 * retired per-collection namespace, or a placement id twice.
 */
function refuseUnknownOrRepeated(
  submitted: readonly WidgetPlacement[],
  visibleIds: ReadonlySet<string>
): void {
  // A card in a namespace core once filled per collection or per Single
  // (`collection/`, `single/`) is refused by its namespace before anything
  // else, and told what replaced it. No widget answers to one (the registry
  // refuses the namespaces), so the check below would refuse it too; this one
  // says why. It discloses nothing: the namespaces are core's, the same for
  // every install and every reader.
  for (const { widgetId } of submitted) {
    const replacement = retiredWidgetReplacement(widgetId);
    if (replacement === undefined) continue;
    throw NextlyError.validation({
      errors: [
        {
          path: "placements",
          code: "INVALID_VALUE",
          message: `"${widgetId}" ${replacement}`,
        },
      ],
    });
  }

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
 * Refuses a card whose text setting is over the length its widget declares.
 *
 * A placement's `config` is otherwise opaque here, bounded only by size; a
 * widget's own `textarea` setting is the one value this endpoint judges, so a
 * note a sheet would refuse cannot be saved by writing the layout directly.
 * Counted with `textLength`, the counter the settings sheet uses, so the sheet
 * and this write agree on what fits.
 *
 * Judged only where the value CHANGED from the one the caller was shown: a
 * note saved before its widget lowered the bound can still be saved as it is,
 * while a new or edited one is held to the bound.
 *
 * The bounds come from the canonical set the caller sees, so a widget is held
 * to its textarea's bound whichever channel declared it: a contribution's
 * settings reach no registry, and reading the registry alone let a direct
 * write store any length of text on a contributed widget.
 */
function refuseOverlongText(
  submitted: readonly WidgetPlacement[],
  shown: readonly WidgetPlacement[],
  widgets: readonly CanonicalWidget[]
): void {
  const shownById = new Map(shown.map(p => [p.id, p]));
  const boundsById = new Map(
    widgets.map(widget => [widget.id, widget.textBounds ?? []])
  );
  for (const placement of submitted) {
    const overlong = overlongTextIn(
      placement,
      shownById.get(placement.id),
      boundsById.get(placement.widgetId) ?? []
    );
    if (overlong) {
      throw NextlyError.validation({
        errors: [
          {
            path: "placements",
            code: "TOO_LONG",
            message: `"${overlong.label}" is at most ${overlong.maxLength} characters.`,
          },
        ],
      });
    }
  }
}

/**
 * The first textarea setting of `placement` whose value changed from the one
 * `shown` held and is over its widget's bound, or `undefined`.
 */
function overlongTextIn(
  placement: WidgetPlacement,
  shown: WidgetPlacement | undefined,
  bounds: readonly TextBound[]
): { label: string; maxLength: number } | undefined {
  for (const bound of bounds) {
    const value = changedText(placement, shown, bound.name);
    if (value !== undefined && textLength(value) > bound.maxLength) {
      return { label: bound.label, maxLength: bound.maxLength };
    }
  }
  return undefined;
}

/**
 * The text `placement` holds for `name`, when it is text and changed from what `shown` held.
 *
 * Unchanged only where the shown placement was a card of the SAME widget: an id reused for
 * another widget is a new card, so text carried over from a widget with no bound is held to
 * this one's.
 */
function changedText(
  placement: WidgetPlacement,
  shown: WidgetPlacement | undefined,
  name: string
): string | undefined {
  const value = placement.config?.[name];
  const unchanged =
    shown?.widgetId === placement.widgetId && shown.config?.[name] === value;
  return typeof value === "string" && !unchanged ? value : undefined;
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
  sizes: Readonly<Record<string, WidgetSizeFacts>>
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
    if (sizes[widgetId]?.allowsSeveral) continue;
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
 *
 * A row of an earlier format is NOT unreadable: it is no saved arrangement,
 * so every write, a single-card one included, replaces it without asking, as
 * it would create a row for someone who had none.
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

/**
 * The widget ids a save replaces, as opposed to carries.
 *
 * Every visible widget, except a Get started card the submission does not
 * hold: a dormant card is never handed to the reader, so their save cannot
 * hold it, and replacing it would delete it with its skips. Carried instead,
 * in place, as a card the reader could not see is. A submission that holds
 * the card replaces it as usual.
 */
function carriedUnlessSubmitted(
  submitted: readonly WidgetPlacement[],
  visibleIds: ReadonlySet<string>
): ReadonlySet<string> {
  if (getStartedPlacement(submitted) !== undefined) return visibleIds;
  return new Set([...visibleIds].filter(id => id !== GET_STARTED_WIDGET_ID));
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
  // An earlier format's body has no `w` and `h`, and is refused here by the
  // same rules a stored row is read with. A size is judged only as one the
  // grid can draw: one outside the widget's current bounds is stored as sent
  // and drawn at the nearest size inside them, as a stored one is.
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
  const stored = await service.getLayout(SCOPE_KIND, view.caller.userId);
  // A reader still following the default was handed it less the cards it
  // would not show them, and writes back what they were handed: those cards
  // are carried into the row as cards they may not see are, never dropped.
  // The token covers them, so a write staged against other verdicts is
  // refused before anything is merged.
  const { notShown, scope } = await readerCards(
    auth,
    view,
    stored.layout,
    req.signal
  );
  refuseStaleScope(submittedScope, scope);
  refuseUnknownOrRepeated(submitted, view.visibleIds);
  refuseUnreadableCollections(submitted, view.withheld);
  refuseUnconfirmedReplacement(
    stored.unreadable,
    writeArranges,
    replaceUnreadable
  );
  const shown = visibleArrangement(stored.layout, view, notShown);
  refuseExtraCards(submitted, shown, sizesOf(view.widgets));
  refuseOverlongText(submitted, shown, view.widgets);

  // 🔴 MONOTONIC. A row a reader has arranged stays arranged whatever a later
  // write says: a removal outside customise mode states `false` because IT is
  // not an arrangement, and taking that at its word would demote a reader's
  // own layout to the default and discard every move they ever made.
  const arranged =
    writeArranges ||
    (stored.layout !== undefined && layoutIsArranged(stored.layout));

  const saved = mergePreservingHidden(
    submitted,
    wholeArrangement(stored.layout),
    carriedUnlessSubmitted(submitted, view.visibleIds),
    withheldFrom(stored.layout, view, notShown)
  );
  const version = await service.saveLayout(
    SCOPE_KIND,
    view.caller.userId,
    saved,
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
      // The token the next write is checked against, from the row as just
      // saved: a setting this write changed may change a card's verdict. An
      // arranged row's cards answer for themselves, so it covers none.
      scope: arranged
        ? view.scope
        : (
            await readerCards(
              auth,
              view,
              {
                schemaVersion: LAYOUT_SCHEMA_VERSION,
                placements: saved,
                unarranged: true,
              },
              req.signal
            )
          ).scope,
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
  // Checked against the token the read handed out, which covers the
  // default's cards a reader following it was not shown.
  const stored = await service.getLayout(SCOPE_KIND, view.caller.userId);
  const { scope } = await readerCards(auth, view, stored.layout, req.signal);
  refuseStaleScope(submittedScope, scope);
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
