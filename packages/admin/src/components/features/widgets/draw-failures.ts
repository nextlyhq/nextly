"use client";

/**
 * Which cards' own components threw while drawing an answer, or are missing
 * from the admin altogether, as the grid counts them, and what such a card says.
 *
 * The grid counts each card's outcome from its answer, and a component that
 * throws has an answer that was fine: only the card knows its component then
 * failed. It says so here, so the grid counts that card as failed rather than
 * updated, and says so again when a later draw succeeds.
 *
 * @module components/features/widgets/draw-failures
 */

import { createContext, useCallback, useState } from "react";

import { hasComponent } from "@admin/lib/plugins/component-registry";

/** What a throw while drawing says, in the card's own words. */
export const DREW_NOTHING = "Its component stopped while drawing.";

/** What a card whose component is missing says in production: nothing about the app's code. */
export const COMPONENT_MISSING = "Its component could not be loaded.";

/**
 * What a card drawn by its own component says when the admin holds no component at its path,
 * or `undefined` while it does. In development it names the widget, its owner and the path, and
 * the fix; in production only that it could not be loaded, as `development` is read from the
 * server (`AdminBranding.devReload`).
 *
 * The component registry is filled before the admin draws, when the app's generated component
 * map is imported, so a path it does not hold now is one no draw will find: the map was
 * generated before the widget was declared, or the app does not import it.
 */
export function missingComponentMessage(
  definition: { id: string; component?: string; owner?: string },
  development: boolean
): string | undefined {
  const path = definition.component;
  if (path === undefined || hasComponent(path)) return undefined;
  if (!development) return COMPONENT_MISSING;
  const owner = definition.owner === undefined ? "" : ` of ${definition.owner}`;
  return (
    `Widget "${definition.id}"${owner} draws with ${path}, which is not in the app's ` +
    "component map. Run `npx nextly generate:types`, or start `next dev` once, then commit " +
    "both generated files."
  );
}

/** A card telling the grid whether its component failed to draw. */
export type DrawFailureReport = (placementId: string, failed: boolean) => void;

/** Where a card reports a failed draw; absent outside a grid. */
export const DrawFailureContext = createContext<DrawFailureReport | undefined>(
  undefined
);

const NONE: ReadonlySet<string> = new Set();

/**
 * The placements whose component failed to draw, and the report that keeps
 * them. A report that changes nothing keeps the same set, so the grid's
 * counts are not recomputed for it.
 */
export function useDrawFailures(): {
  failed: ReadonlySet<string>;
  report: DrawFailureReport;
} {
  const [failed, setFailed] = useState<ReadonlySet<string>>(NONE);
  const report = useCallback<DrawFailureReport>((placementId, didFail) => {
    setFailed(current => {
      if (current.has(placementId) === didFail) return current;
      const next = new Set(current);
      if (didFail) next.add(placementId);
      else next.delete(placementId);
      return next;
    });
  }, []);
  return { failed, report };
}
