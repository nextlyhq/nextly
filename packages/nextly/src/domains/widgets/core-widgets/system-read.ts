/**
 * Core's own sources, as core's declared cards read them in their `load`.
 *
 * A card such as Team or Upcoming releases is answered by a `system:` source
 * whose resolver reaches a core service (`ReleasesService`, the activity log).
 * Its `load` asks that source as the caller the card's read services were
 * bound for, so an API key is judged by its own grant rather than by the
 * person who made it, and the source decides who may see what exactly as it
 * does for any other read.
 *
 * The read is handed to this module once, at boot (`provideCoreSourceRead`),
 * rather than imported: who the caller is comes from the batch's binding, and
 * the resolvers reach the services core reads through, while the widget list
 * is read by the admin's own tests and by every reader of core's ids, none of
 * which should reach either. Internal to core: no public entry point exports
 * any of it.
 *
 * @module domains/widgets/core-widgets/system-read
 */

import { NextlyError } from "../../../errors/nextly-error";
import { answerAsAsked } from "../answer-as-asked";
import type { WidgetReadServices } from "../declaration/define-widget";
import { sentAsJson, sentRows } from "../declaration/transportable";
import { processHeld } from "../process-held";
import type { WidgetQuery } from "../query";
import type { WidgetResult } from "../result";

import type { CoreListWidgetData } from "./data";

/** What a card's `load` hands a read: its services, signal and instant. */
interface CardReadInput {
  services: WidgetReadServices;
  signal: AbortSignal;
  now: Date;
}

/**
 * The answer of the `system:` source `query` names, read as the caller
 * `services` were bound for, within the card's signal and as of the batch's
 * instant.
 */
type CoreSourceRead = (
  query: WidgetQuery,
  services: WidgetReadServices,
  opts: { signal: AbortSignal; now: Date }
) => Promise<unknown>;

/**
 * The read boot provided, held for the process (`processHeld`): Next.js and
 * Turbopack can evaluate this module in more than one server graph, and boot,
 * which provides it, and the card answered on a request can each hold a
 * different copy.
 */
const provided = processHeld(
  "nextly.dashboard.coreSourceRead",
  (): { read?: CoreSourceRead } => ({}),
  (held): held is { read?: CoreSourceRead } =>
    typeof held === "object" && held !== null
);

/** Hands core's cards the read of core's own sources; boot does. */
export function provideCoreSourceRead(read: CoreSourceRead): void {
  provided.read = read;
}

/**
 * `query`'s answer from the `system:` source it names, as the card's caller,
 * held to the op it asked (`answerAsAsked`), as the batch holds a resolver's
 * answer.
 */
export async function readCoreSource(
  query: WidgetQuery,
  { services, signal, now }: CardReadInput
): Promise<WidgetResult> {
  const { read } = provided;
  if (read === undefined) {
    // Booted without core's sources: a fault of the install, never an empty
    // card that would say there is nothing to show.
    throw NextlyError.internal({
      logContext: {
        reason: "core-source-read-not-provided",
        source: query.source,
      },
    });
  }
  return answerAsAsked(query, await read(query, services, { signal, now }));
}

/**
 * A list query's answer as a list card draws it: the rows as JSON carries
 * them, and whatever the same read counted beside them.
 */
export async function readCoreList(
  query: WidgetQuery & { op: "list" },
  input: CardReadInput
): Promise<CoreListWidgetData> {
  const answer = await readCoreSource(query, input);
  // `answerAsAsked` admitted only a list for a list query; narrowed here for
  // the compiler, and refused again should that rule ever change.
  if (answer.op !== "list") {
    throw NextlyError.internal({
      logContext: {
        reason: "core-source-answered-another-op",
        source: query.source,
      },
    });
  }
  const { total, atLeast, totalByKind, window } = answer;
  return {
    items: sentRows(sentAsJson(answer.items)),
    ...(total === undefined ? {} : { total }),
    ...(atLeast === true ? { atLeast: true } : {}),
    ...(totalByKind === undefined ? {} : { totalByKind: { ...totalByKind } }),
    ...(window === undefined ? {} : { window: { days: window.days } }),
  };
}
