/**
 * GET /api/dashboard/summary
 *
 * The dashboard header's live summary for the reader, and the environment the
 * site names: each part read from the source its card reads, as the reader, so
 * the header and the card never disagree (`services/dashboard/header-summary`).
 *
 * Every part is read at once and on its own: one that throws is reported as
 * failed and the rest are answered, so the admin never words the line as "all
 * caught up" while a part is unknown. A source the reader may not read at all
 * gives no part and no failure: nothing is counted, named or hinted at.
 *
 * Caching: `private, no-store`. The answer is per reader.
 *
 * @module api/dashboard-summary
 */

import type { AuthContext } from "../auth/middleware";
import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { callerMayReadReleases } from "../domains/releases/releases-widget-source";
import { createBatchScope } from "../domains/widgets/batch-scope";
import { refreshContentSources } from "../domains/widgets/content-sources";
import { declaredWidget } from "../domains/widgets/declaration/declared-widgets";
import { bindReadServices } from "../domains/widgets/declaration/read-services";
import { executeWidgetQuery } from "../domains/widgets/execute";
import { MAX_WIDGET_LIMIT } from "../domains/widgets/query-limits";
import { isUnavailableSourceRefusal } from "../domains/widgets/sources";
import {
  ATTENTION_SOURCE_ID,
  RELEASES_SOURCE_ID,
} from "../domains/widgets/system-source-ids";
import { NextlyError } from "../errors/nextly-error";
import { getHandlerConfig } from "../route-handler/auth-handler";
import {
  attentionPart,
  releasesPart,
  widgetPart,
  type HeaderSummaryPart,
  type PartRead,
} from "../services/dashboard/header-summary";
import type { ReadCaller } from "../services/dashboard/readable-resources";

import { PRIVATE_NO_STORE_HEADERS, readCaller } from "./authenticated-read";
import { respondData } from "./response-shapes";
import { cardIsShownTo } from "./widget-cards";
import { askableCards } from "./widget-layout";
import { cardBatchFor } from "./widget-query";
import { withErrorHandler } from "./with-error-handler";

export const getDashboardSummary = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);
  const reader = await readCaller(auth);
  // As the query endpoint does before it answers a card: the sources a card
  // reads are published by this refresh, not at boot.
  await refreshContentSources();
  const now = new Date();
  const reads = await Promise.all([
    settled(() => attentionRead(reader, req.signal)),
    settled(() => releasesRead(reader, req.signal, now)),
    ...(await widgetSummaryReads(auth, reader, req.signal, now)),
  ]);
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
    { headers: PRIVATE_NO_STORE_HEADERS }
  );
});

/**
 * A part's read, settled: its part or nothing; nothing too where the source is
 * one this reader may not read, as for a source that does not exist; and
 * `"failed"` for anything else that goes wrong.
 */
async function settled(read: () => Promise<PartRead>): Promise<PartRead> {
  try {
    return await read();
  } catch (error) {
    return isUnavailableSourceRefusal(error) ? null : "failed";
  }
}

/** Whether `error` refuses this reader, rather than failing a read. */
function isRefusal(error: unknown): boolean {
  return (
    error instanceof NextlyError &&
    (error.statusCode === 401 || error.statusCode === 403)
  );
}

/** The attention total, from the digest the Needs your attention card lists. */
async function attentionRead(
  reader: ReadCaller,
  signal: AbortSignal
): Promise<PartRead> {
  const result = await executeWidgetQuery(
    { source: ATTENTION_SOURCE_ID, op: "list", limit: MAX_WIDGET_LIMIT },
    reader,
    { signal }
  );
  return result.op === "list" ? attentionPart(result.items) : "failed";
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

/**
 * One read for each widget on the reader's dashboard that declares a
 * `summary`, its first card standing for it: counted as the reader, and only
 * where the card would be shown to them (`cardIsShownTo`, its `access` and
 * `shows`), so the header never counts for a card the reader is not drawn.
 */
async function widgetSummaryReads(
  auth: AuthContext,
  reader: ReadCaller,
  signal: AbortSignal,
  now: Date
): Promise<Promise<PartRead>[]> {
  // A reader with no dashboard of their own (one the layout refuses) has no
  // card to count for: an empty summary, never an error.
  const cards = await askableCards(auth).catch((error: unknown) => {
    if (isRefusal(error)) return undefined;
    throw error;
  });
  if (cards === undefined) return [];
  const { handed } = cards;
  const seen = new Set<string>();
  const batch = cardBatchFor(auth, reader);
  const scope = createBatchScope();
  return [...handed.values()].flatMap(placement => {
    const declared = declaredWidget(placement.widgetId);
    const summary = declared?.declaration.summary;
    if (declared === undefined || summary === undefined) return [];
    if (seen.has(placement.widgetId)) return [];
    seen.add(placement.widgetId);
    return [
      settled(async () => {
        const shown = await cardIsShownTo(declared, placement, batch, {
          signal,
          now,
          scope: scope.forOwner(declared.owner),
        });
        if (!shown) return null;
        // As its card's `load` is handed them: the person, and reads bound to
        // them through the batch's own check.
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
        return widgetPart(
          placement.widgetId,
          placement.id,
          summary.label,
          count
        );
      }),
    ];
  });
}
