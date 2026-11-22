"use client";

/**
 * The one renderer every admin place draws its blocks with.
 *
 * A page hands it its own parts by built-in name, and the place's context:
 * the ids its page is about. It draws the place's blocks in the order the
 * server delivered, each contribution through `PluginSlot`, so each sits
 * behind its own boundary: one that throws draws its own identifiable
 * fallback and the rest of the page stays. With nothing contributed it draws
 * the page's own parts in the catalogue's order, so the page is unchanged.
 * While the page's context is `null` it draws only the page's own parts.
 *
 * A plugin's place has no built-in parts, so its page may hand a `fallback`:
 * what it draws in the place's stead while nothing contributed is drawn
 * there, as when no plugin adds to it. And, as a place's tabs are, a page
 * may hand every block more than the place's context (`blockProps`).
 *
 * @module components/shared/target-slot/TargetSlot
 */
import type { AdminPlaceId, AdminPlaces } from "nextly/config";
import { Fragment, type ReactNode } from "react";

import { PluginSlot } from "@admin/components/shared/plugin-slot";

import { IsolatedContribution } from "./IsolatedContribution";
import { PlaceContributionFallback } from "./PlaceContributionFallback";
import { usePlaceContributions } from "./usePlaceContributions";

/** What every component contributed to a place receives. */
export interface PlaceContributionProps<P extends AdminPlaceId = AdminPlaceId> {
  /** The ids the page is about, as the place's type in `AdminPlaces` says. */
  context: AdminPlaces[P]["context"];
  /** The entry the page shows, as this reader read it, where it shows one. */
  entry?: Record<string, unknown>;
}

/** What a page hands a place's renderer: the place, and what its parts receive. */
export interface PlaceProps<P extends AdminPlaceId> {
  place: P;
  /**
   * The ids the page is about, or `null` while it does not know them yet
   * (the signed-in admin's id before it has loaded): until then only the
   * page's own parts are drawn, so no contribution is ever handed an id that
   * is not the real one.
   */
  context: AdminPlaces[P]["context"] | null;
  /** The entry the page shows, as this reader read it, where it shows one. */
  entry?: Record<string, unknown>;
}

export interface TargetSlotProps<P extends AdminPlaceId> extends PlaceProps<P> {
  /** The page's own parts, by the built-in names the catalogue gives them. */
  builtIns?: Readonly<Record<string, ReactNode>>;
  /**
   * @experimental What the page draws in the place's stead once it knows its
   * ids and no contribution is drawn there, as when no plugin adds to it:
   * for a plugin's place, which has no built-in parts. Nothing while the
   * context is `null`, so it never shows before a contribution could.
   */
  fallback?: ReactNode;
  /**
   * @experimental What each contributed block is handed besides
   * `PlaceContributionProps`, such as what the page is editing. A record, as
   * `PlaceTabs`' `tabProps` is: a block is loaded by its path, so the place's
   * own declaration names the shape its blocks are promised.
   */
  blockProps?: Readonly<Record<string, unknown>>;
}

export function TargetSlot<P extends AdminPlaceId>({
  place,
  context,
  entry,
  builtIns = {},
  fallback,
  blockProps,
}: TargetSlotProps<P>): ReactNode {
  const blocks = usePlaceContributions(place, "block", { context, entry });
  // Nothing drawn at all: a place with built-in parts always draws them, so
  // only a place with none (a plugin's) ever draws its fallback.
  if (blocks.length === 0 && fallback !== undefined) {
    return context === null ? null : fallback;
  }
  // Keyed, so the page's own parts keep their state when the contributions
  // arrive or the context becomes known and the list around them grows.
  return blocks.map(item =>
    "builtIn" in item ? (
      <Fragment key={`builtIn:${item.builtIn}`}>
        {builtIns[item.builtIn] ?? null}
      </Fragment>
    ) : context !== null && item.kind === "block" ? (
      <IsolatedContribution key={item.id}>
        <PluginSlot<PlaceContributionProps<P>>
          path={item.component}
          fallback={<PlaceContributionFallback />}
          props={{
            ...blockProps,
            context,
            ...(entry === undefined ? {} : { entry }),
          }}
        />
      </IsolatedContribution>
    ) : null
  );
}
