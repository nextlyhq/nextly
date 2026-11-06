/**
 * What an archetype body is, as a contract the dispatch table can hold.
 *
 * A body returns an OUTCOME rather than a node, because "this payload is not
 * what I asked for" is a real answer an archetype has to be able to give. A
 * body that could only return a node would have to render its own error box,
 * which is how a dashboard ends up with as many error designs as it has
 * archetypes — and the mismatch has to reach `WidgetCard`, which is the thing
 * that knows to keep the title.
 *
 * @module components/features/widgets/archetypes/types
 */

import type { ReactNode } from "react";

import type {
  DashboardWidget,
  WidgetResult,
} from "@admin/types/dashboard/widgets";

import type { CardEmptyContent } from "../frame/states";

export type ArchetypeOutcome =
  | { ok: true; node: ReactNode; empty?: undefined }
  /**
   * Nothing to show: the frame draws its one empty state from this, so every card says
   * "nothing yet" in the same words and look, instead of each archetype its own sentence.
   * `node` is declared absent rather than missing, so code that reads a drawn body's `node`
   * still type-checks and finds nothing.
   */
  | { ok: true; empty: CardEmptyContent; node?: undefined }
  | { ok: false; message: string };

export type ArchetypeBody = (
  result: WidgetResult,
  definition: DashboardWidget
) => ArchetypeOutcome;
