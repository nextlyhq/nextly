/**
 * GET /api/dashboard/summary
 *
 * The dashboard header's live summary for the reader, and the environment the
 * site names: each part read from the source its card reads, as the reader, so
 * the header and the card never disagree (`services/dashboard/header-summary`).
 *
 * Every part is read at once and on its own, within a card's time budget: one
 * that throws, or that does not answer in time, is reported as failed and the
 * rest are answered, so the admin never words the line as "all caught up"
 * while a part is unknown. A source the reader may not read at all gives no
 * part and no failure: nothing is counted, named or hinted at.
 *
 * Caching: `private, no-store`. The answer is per reader.
 *
 * @module api/dashboard-summary
 */

import type { AuthContext } from "../auth/middleware";
import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { callerMayReadReleases } from "../domains/releases/releases-widget-source";
import {
  createBatchScope,
  type BatchScope,
} from "../domains/widgets/batch-scope";
import { refreshContentSources } from "../domains/widgets/content-sources";
import {
  declaredWidget,
  type DeclaredWidget,
} from "../domains/widgets/declaration/declared-widgets";
import { bindReadServices } from "../domains/widgets/declaration/read-services";
import { executeWidgetQuery } from "../domains/widgets/execute";
import type { WidgetPlacement } from "../domains/widgets/layout";
import { MAX_WIDGET_LIMIT } from "../domains/widgets/query-limits";
import { isUnavailableSourceRefusal } from "../domains/widgets/sources";
import { RELEASES_SOURCE_ID } from "../domains/widgets/system-source-ids";
import { NextlyError } from "../errors/nextly-error";
import { getHandlerConfig } from "../route-handler/auth-handler";
import { readAttentionDigest } from "../services/dashboard/attention-source";
import {
  attentionPart,
  releasesPart,
  widgetPart,
  type HeaderSummaryPart,
  type PartRead,
} from "../services/dashboard/header-summary";
import type { ReadCaller } from "../services/dashboard/readable-resources";

import { PRIVATE_NO_STORE_HEADERS, readCaller } from "./authenticated-read";
import { respondData, SKIP_DATE_FORMATTING_HEADER } from "./response-shapes";
import { cardShownTo, type CardBatch, type CardShown } from "./widget-cards";
import { askableCards } from "./widget-layout";
import { cardBatchFor } from "./widget-query";
import { SLOT_TIMEOUT_MS, withinSlotBudget } from "./widget-slots";
import { withErrorHandler } from "./with-error-handler";

export const getDashboardSummary = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);
  const reader = await readCaller(auth);
  // As the query endpoint does before it answers a card: the sources a card
  // reads are published by this refresh, not at boot.
  await refreshContentSources();
  const now = new Date();
  const [attention, releases, widgets] = await Promise.all([
    settled(signal => attentionRead(reader, signal, now), req.signal),
    settled(signal => releasesRead(reader, signal, now), req.signal),
    widgetSummaryReads(auth, reader, req.signal, now),
  ]);
  const reads = [attention, releases, ...widgets];
  const environment = getHandlerConfig()?.admin?.environment;
  return respondData(
    {
      parts: reads.filter(
        (read): read is HeaderSummaryPart => read !== null && read !== "failed"
      ),
      // How many parts could not be read, so the admin never calls the
      // reader caught up while one is unknown.
      failed: reads.filter(read => read === "failed").length,
      ...(environment === undefined
        ? {}
        : {
            environment: {
              label: environment.label,
              tone: environment.tone ?? "neutral",
            },
          }),
    },
    { headers: SUMMARY_HEADERS }
  );
});

/**
 * Private to the reader, and passed through the route handler's date pass
 * untouched: the answer carries labels a site or a plugin wrote (the
 * environment's, a widget summary's), which are shown exactly as written even
 * when one reads as a timestamp, and `nearest`, already an absolute ISO instant
 * the admin reads on the reader's own clock.
 */
const SUMMARY_HEADERS = {
  ...PRIVATE_NO_STORE_HEADERS,
  [SKIP_DATE_FORMATTING_HEADER]: "1",
} as const;

/**
 * A part's read, settled within a card's time budget (`withinSlotBudget`), so
 * one source that never answers fails its own part rather than holding the
 * whole line: its part or nothing; nothing too where the source is one this
 * reader may not read, as for a source that does not exist; and `"failed"` for
 * anything else that goes wrong, a read past its budget included.
 *
 * @param request the request's signal: the part's own is aborted by it, and by
 * the budget running out.
 */
async function settled(
  read: (signal: AbortSignal) => Promise<PartRead>,
  request: AbortSignal
): Promise<PartRead> {
  try {
    return await withinSlotBudget(read, partTimedOut, request);
  } catch (error) {
    return isUnavailableSourceRefusal(error) ? null : "failed";
  }
}

/** The failure of a part whose read ran past its budget. */
function partTimedOut(): never {
  throw new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: "Part of the dashboard summary took too long to answer",
    logMessage: `A dashboard summary part was not read within ${SLOT_TIMEOUT_MS}ms`,
    logContext: {
      reason: "dashboard-summary-part-timed-out",
      timeoutMs: SLOT_TIMEOUT_MS,
    },
  });
}

/** Whether `error` refuses this reader, rather than failing a read. */
function isRefusal(error: unknown): boolean {
  return (
    error instanceof NextlyError &&
    (error.statusCode === 401 || error.statusCode === 403)
  );
}

/**
 * The attention part, from the one read of the attention digest the Needs your
 * attention card draws (`readAttentionDigest`), as the same reader its card is
 * answered for, at the summary's instant: one number, how many items it holds
 * (`attentionPart`), which is the count the card's title shows.
 */
async function attentionRead(
  reader: ReadCaller,
  signal: AbortSignal,
  now: Date
): Promise<PartRead> {
  return attentionPart(await readAttentionDigest(reader, { signal, now }));
}

/**
 * The releases due within the week, from the source the Upcoming releases card
 * lists, soonest first. Only for a reader who may read releases: for anyone
 * else there is nothing to count, and nothing to say.
 */
async function releasesRead(
  reader: ReadCaller,
  signal: AbortSignal,
  now: Date
): Promise<PartRead> {
  if (!(await callerMayReadReleases(reader))) return null;
  const result = await executeWidgetQuery(
    {
      source: RELEASES_SOURCE_ID,
      op: "list",
      select: ["id", "scheduledAt"],
      limit: MAX_WIDGET_LIMIT,
    },
    reader,
    { signal }
  );
  return result.op === "list"
    ? releasesPart(result.items, now, MAX_WIDGET_LIMIT)
    : "failed";
}

/** The cards on a reader's dashboard, as the layout hands them. */
type PlacedCards = Awaited<ReturnType<typeof askableCards>>;

/**
 * The cards on the reader's dashboard, read within a part's budget as a part
 * is: none for a reader with no dashboard of their own (one the layout
 * refuses), who has no card to count for; `"failed"` when the layout throws or
 * does not answer in time, so its outage is one unknown part rather than the
 * whole line.
 */
async function placedCards(
  auth: AuthContext,
  request: AbortSignal
): Promise<PlacedCards | undefined | "failed"> {
  try {
    return await withinSlotBudget(
      () => askableCards(auth),
      partTimedOut,
      request
    );
  } catch (error) {
    return isRefusal(error) ? undefined : "failed";
  }
}

/**
 * One read for each widget on the reader's dashboard that declares a
 * `summary`: counted as the reader, and only where one of its cards would be
 * shown to them (`cardShownTo`, its `access` and `shows`), so the header
 * never counts for a card the reader is not drawn. A widget placed more than
 * once is judged card by card, in the dashboard's order, until one is shown;
 * that card is the one the part names, and the widget is counted once.
 *
 * A dashboard that could not be read is one failed part, standing for every
 * summary it may have held.
 */
async function widgetSummaryReads(
  auth: AuthContext,
  reader: ReadCaller,
  request: AbortSignal,
  now: Date
): Promise<PartRead[]> {
  const cards = await placedCards(auth, request);
  if (cards === "failed") return ["failed"];
  if (cards === undefined) return [];
  const placementsOf = new Map<string, WidgetPlacement[]>();
  for (const placement of cards.handed.values()) {
    const placements = placementsOf.get(placement.widgetId) ?? [];
    placements.push(placement);
    placementsOf.set(placement.widgetId, placements);
  }
  const judging: Judging = {
    batch: cardBatchFor(auth, reader),
    scope: createBatchScope(),
    now,
  };
  return Promise.all(
    [...placementsOf].flatMap(([widgetId, placements]) => {
      const declared = declaredWidget(widgetId);
      if (declared?.declaration.summary === undefined) return [];
      return [
        settled(
          signal => widgetRead(declared, placements, judging, signal),
          request
        ),
      ];
    })
  );
}

/**
 * What every widget's part is judged and counted with: the reader's batch,
 * its share scope and the request's instant.
 */
interface Judging {
  batch: CardBatch;
  scope: BatchScope;
  now: Date;
}

/**
 * One widget's part: its count, for the first of its cards shown to the
 * reader. None where no card of it is shown; `"failed"` where none is shown
 * and one could not be judged, since the batch draws that card as failed and
 * the part is then unknown rather than nothing.
 */
async function widgetRead(
  declared: DeclaredWidget,
  placements: readonly WidgetPlacement[],
  { batch, scope, now }: Judging,
  signal: AbortSignal
): Promise<PartRead> {
  const { summary } = declared.declaration;
  if (summary === undefined) return null;
  const shown = await firstShown(placements, placement =>
    cardShownTo(declared, placement, batch, {
      signal,
      now,
      scope: scope.forOwner(declared.owner),
    })
  );
  if (shown === undefined) return null;
  if (shown === "failed") return "failed";
  // As its card's `load` is handed them: the person, and reads bound to
  // them through the batch's own check, under the part's own signal.
  const count = await summary.count({
    user: batch.caller.user,
    signal,
    services: bindReadServices({
      caller: batch.caller,
      prepare: batch.check,
      signal,
      now,
      ...(declared.collections === undefined
        ? {}
        : { collections: declared.collections }),
    }),
  });
  return widgetPart(shown.widgetId, shown.id, summary.label, count);
}

/**
 * The first of a widget's cards judged shown, in the dashboard's order; else
 * `"failed"` where one of them could not be judged, since that card may be
 * the one shown; else none.
 */
async function firstShown(
  placements: readonly WidgetPlacement[],
  judge: (placement: WidgetPlacement) => Promise<CardShown>
): Promise<WidgetPlacement | undefined | "failed"> {
  let failed = false;
  for (const placement of placements) {
    const verdict = await judge(placement);
    if (verdict === "shown") return placement;
    failed ||= verdict === "failed";
  }
  return failed ? "failed" : undefined;
}
