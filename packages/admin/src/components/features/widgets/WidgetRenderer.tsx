"use client";

/**
 * Dispatches a widget to its archetype body, inside the one card.
 *
 * The card is drawn HERE rather than by each archetype, so an archetype added
 * later contributes a body function and inherits the header, the footer, the
 * busy state, the error presentation and the region label without deciding any
 * of them again. Adding `table`, `list`, `text` and `actions` is one entry in
 * `ARCHETYPE_BODIES` each.
 *
 * WHICH of those states a widget is in is decided by `resolveWidgetOutcome`
 * rather than here, because the grid has to count the same answer for its live
 * region. See `./outcome`.
 *
 * `custom` is the exception, and it does NOT get a second resolution path: it
 * goes through `PluginSlot`, which already resolves a component path against
 * the registry and already isolates a throw behind `PluginComponentBoundary`.
 * A widget-specific resolver beside it would be a second place for a plugin
 * component to fail differently.
 *
 * @module components/features/widgets/WidgetRenderer
 */

import type { ReactNode } from "react";

import * as Icons from "@admin/components/icons";
import { PluginSlot } from "@admin/components/shared/plugin-slot";
import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { resolveWidgetOutcome } from "./outcome";
import { WidgetCard } from "./WidgetCard";

/**
 * A Lucide icon component for the definition's icon NAME, or nothing.
 *
 * Names arrive from a plugin's declaration, so an unknown one is expected
 * input. It resolves to nothing rather than to a placeholder glyph: an icon is
 * meant to be functional here, and a stand-in that means nothing is worse than
 * the header simply not having one.
 */
function resolveIcon(name: string | undefined): ReactNode {
  if (!name) return undefined;
  const icons = Icons as unknown as Record<
    string,
    Icons.LucideIcon | undefined
  >;
  const Icon = icons[name];
  return Icon ? <Icon className="h-4 w-4" /> : undefined;
}

export interface WidgetRendererProps {
  definition: DashboardWidget;
  /**
   * This widget's slot from the batch. `undefined` means the batch has not
   * answered yet — which is why a data widget with no slot is BUSY rather than
   * empty, and a widget that asked for nothing is neither.
   */
  slot: WidgetSlot | undefined;
  /** When the batch this slot came from landed, for the freshness line. */
  updatedAt?: Date | null;
  /**
   * Whether a request for this widget is in flight RIGHT NOW, including a
   * background refetch that is keeping the previous answer on screen.
   *
   * Separate from the slot's absence, which is only ever the first load. This
   * grid refetches on every window focus and the cards deliberately keep their
   * numbers through it, so without this a reader using a screen reader had no
   * way to know the dashboard was reading again.
   */
  isFetching?: boolean;
}

export function WidgetRenderer({
  definition,
  slot,
  updatedAt = null,
  isFetching = false,
}: WidgetRendererProps) {
  const shared = {
    title: definition.title,
    icon: resolveIcon(definition.icon),
    link: definition.link,
  };

  const outcome = resolveWidgetOutcome(definition, slot);

  // The escape hatch. A plugin component draws its own body, so the card
  // asserts nothing about its loading or empty states -- the component knows
  // what it is showing and the card does not.
  //
  // It DOES receive its slot. `custom` is deliberately allowed to carry a
  // query: core's own validator puts it in neither the data set nor the
  // query-less set, because a widget that draws itself may still want the host
  // to run its request. The grid honours that by putting the query in the
  // batch, so withholding the answer here would make every such widget pay for
  // a database read on every mount and every window focus and then fetch the
  // same data again for itself. `undefined` while the batch is in flight, and
  // the component decides what that looks like.
  if (outcome.state === "self-drawn") {
    return (
      <WidgetCard {...shared}>
        <PluginSlot
          path={definition.component}
          props={{ widgetId: definition.id, slot }}
        />
      </WidgetCard>
    );
  }

  if (outcome.state === "loading") {
    return (
      <WidgetCard {...shared} isLoading>
        {null}
      </WidgetCard>
    );
  }

  // From here down the card is showing an ANSWER, so `isLoading` reports a
  // refetch rather than a first load -- it marks the body busy and leaves what
  // is already there alone, which is the whole reason the card marks rather
  // than replaces.
  if (outcome.state === "failed") {
    return (
      <WidgetCard
        {...shared}
        error={outcome.message}
        updatedAt={updatedAt}
        isLoading={isFetching}
      >
        {null}
      </WidgetCard>
    );
  }

  return (
    <WidgetCard {...shared} updatedAt={updatedAt} isLoading={isFetching}>
      {outcome.node}
    </WidgetCard>
  );
}
