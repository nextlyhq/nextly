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

import {
  authorizationGroups,
  callerHoldsPermission,
  type ReadAccessCaller,
} from "../auth/entity-read-access";
import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import type { WidgetDefinition } from "../domains/widgets/definition";
import {
  defaultPlacements,
  layoutSizeProblem,
  mergePreservingHidden,
  partitionPlacements,
  readPlacements,
  visibilityToken,
  type WidgetPlacement,
} from "../domains/widgets/layout";
import { listWidgets } from "../domains/widgets/registry";
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
import { readJsonBody } from "./read-json-body";
import { respondData } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

/** Which layer the returned arrangement came from. */
type LayoutSource = "own" | "default";

/**
 * The scope a layout belongs to today.
 *
 * Every row this endpoint writes is the caller's own. The role layer is
 * designed into the table's key and deliberately not built (founder,
 * 2026-09-01), so there is exactly one scope kind to resolve and no resolution
 * ORDER to get wrong yet.
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
): Promise<WidgetDefinition[]> {
  const all = listWidgets();

  const slugs = [
    ...new Set(
      all
        .map(widget => widget.requiredPermission)
        .filter(
          (slug): slug is string => typeof slug === "string" && slug !== ""
        )
    ),
  ];

  const verdicts = new Map<string, boolean>();
  for (const group of authorizationGroups(slugs)) {
    const settled = await Promise.allSettled(
      group.map(slug => callerHoldsPermission(slug, caller))
    );
    group.forEach((slug, index) => {
      const outcome = settled[index];
      // A rejected decision denies. A permission check that threw has told us
      // nothing, and "nothing" must not read as "allowed" -- the same
      // fail-closed direction `canReadEntity` takes when RBAC is unreachable.
      verdicts.set(slug, outcome.status === "fulfilled" && outcome.value);
    });
  }

  return all.filter(widget => {
    const slug = widget.requiredPermission;
    if (typeof slug !== "string" || slug === "") return true;
    return verdicts.get(slug) === true;
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
    : defaultPlacements(widgets);

  return respondData(
    {
      placements,
      version: stored.version,
      source,
      scope: visibilityToken(widgets.map(w => w.id)),
    },
    { headers: PRIVATE_NO_STORE_HEADERS }
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

export const putWidgetLayout = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  const body = await readJsonBody(req);
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

  const service = await getLayoutService();
  const resolved = await readCaller(auth);
  const caller = readAccessCaller(resolved);

  // A dashboard arrangement is one person's personalization of their own admin
  // screen, and an API key has no screen. Refused rather than gated behind a
  // permission slug, because there is no grant that would make it meaningful:
  // the key would be rewriting the layout of whoever minted it. Reading stays
  // open -- a read tells a key nothing it could not already ask the registry.
  if (caller.authMethod === "api-key") {
    // `forbidden` carries a fixed public message by design, so the reason
    // travels in the log rather than to the caller.
    throw NextlyError.forbidden({
      logContext: { reason: "an api key may not write a dashboard layout" },
    });
  }

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
  // An unreadable row contributes nothing to carry through: its contents could
  // not be decoded, so there is no invisible placement to preserve. The write
  // replaces it wholesale, which is the repair.
  const carried = stored.layout
    ? partitionPlacements(stored.layout.placements, visibleIds).invisible
    : [];

  const toStore = mergePreservingHidden(submitted, carried);
  const tooLarge = layoutSizeProblem(toStore);
  if (tooLarge !== undefined) {
    throw NextlyError.validation({
      errors: [{ path: "placements", code: "TOO_LARGE", message: tooLarge }],
    });
  }

  const version = await service.saveLayout(
    SCOPE_KIND,
    caller.userId,
    toStore,
    expectedVersion
  );

  return respondData(
    {
      placements: submitted,
      version,
      source: "own" satisfies LayoutSource,
      // Echoed so a client can make a second edit without a round trip. It is
      // the token this write was checked against, which is still current: any
      // change to it since would have to have happened during the write, and
      // the next PUT will catch that on its own terms.
      scope,
    },
    { headers: PRIVATE_NO_STORE_HEADERS }
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
