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

export type ArchetypeOutcome =
  | { ok: true; node: ReactNode }
  | { ok: false; message: string };

export type ArchetypeBody = (
  result: WidgetResult,
  definition: DashboardWidget
) => ArchetypeOutcome;
