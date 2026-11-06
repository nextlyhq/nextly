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
 *
 * @module components/shared/target-slot/TargetSlot
 */
import type { AdminPlaceId, AdminPlaces } from "nextly/config";
import { Fragment, type ReactNode } from "react";

import { PluginSlot } from "@admin/components/shared/plugin-slot";

import { usePlaceContributions } from "./usePlaceContributions";

/** What every component contributed to a place receives. */
export interface PlaceContributionProps<P extends AdminPlaceId = AdminPlaceId> {
  /** The ids the page is about, as the place's type in `AdminPlaces` says. */
  context: AdminPlaces[P]["context"];
  /** The entry the page shows, as this reader read it, where it shows one. */
  entry?: Record<string, unknown>;
}

export interface TargetSlotProps<P extends AdminPlaceId>
  extends PlaceContributionProps<P> {
  place: P;
  /** The page's own parts, by the built-in names the catalogue gives them. */
  builtIns?: Readonly<Record<string, ReactNode>>;
}

export function TargetSlot<P extends AdminPlaceId>({
  place,
  context,
  entry,
  builtIns = {},
}: TargetSlotProps<P>): ReactNode {
  const blocks = usePlaceContributions(place, "block", entry);
  return blocks.map(item =>
    "builtIn" in item ? (
      <Fragment key={`builtIn:${item.builtIn}`}>
        {builtIns[item.builtIn] ?? null}
      </Fragment>
    ) : item.kind === "block" ? (
      <PluginSlot<PlaceContributionProps<P>>
        key={item.id}
        path={item.component}
        props={{ context, ...(entry === undefined ? {} : { entry }) }}
      />
    ) : null
  );
}
