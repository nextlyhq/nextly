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
 * `custom` is the exception, and it does NOT get a second resolution path: it
 * goes through `PluginSlot`, which already resolves a component path against
 * the registry and already isolates a throw behind `PluginComponentBoundary`.
 * A widget-specific resolver beside it would be a second place for a plugin
 * component to fail differently.
 *
 * @module components/features/widgets/WidgetRenderer
 */

import type { WidgetArchetype } from "nextly/config";
import type { ReactNode } from "react";

import * as Icons from "@admin/components/icons";
import { PluginSlot } from "@admin/components/shared/plugin-slot";
import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { metricBody } from "./archetypes/metric";
import type { ArchetypeBody } from "./archetypes/types";
import { WidgetCard } from "./WidgetCard";

/**
 * The archetypes core draws from a query result.
 *
 * Partial on purpose: an archetype with no entry is one this release does not
 * render, and the card says so by name rather than coming up blank. `custom`
 * is deliberately absent — it is not drawn from a result at all.
 */
const ARCHETYPE_BODIES: Partial<Record<WidgetArchetype, ArchetypeBody>> = {
  metric: metricBody,
};

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
}

export function WidgetRenderer({
  definition,
  slot,
  updatedAt = null,
}: WidgetRendererProps) {
  const shared = {
    title: definition.title,
    icon: resolveIcon(definition.icon),
    link: definition.link,
  };

  // The escape hatch. A plugin component owns its own loading and empty states
  // and never took part in the batch, so the card asserts nothing about either.
  if (definition.archetype === "custom") {
    return (
      <WidgetCard {...shared}>
        <PluginSlot
          path={definition.component}
          props={{ widgetId: definition.id }}
        />
      </WidgetCard>
    );
  }

  const body = ARCHETYPE_BODIES[definition.archetype];
  if (!body) {
    return (
      <WidgetCard
        {...shared}
        error={`The "${definition.archetype}" widget archetype is not rendered yet.`}
      >
        {null}
      </WidgetCard>
    );
  }

  if (!slot) {
    // Absent means IN FLIGHT, and only a widget that actually asked for
    // something can have a request in flight. One with no query never will, so
    // reading its absent slot as busy leaves the card spinning for the life of
    // the page -- with nothing on screen, in the live region or in the console
    // saying why. `resolve-widgets` prefers a contributed component over this,
    // so reaching here means there was none to prefer.
    if (!definition.query) {
      return (
        <WidgetCard
          {...shared}
          error={`The "${definition.archetype}" archetype is drawn from a query, and this widget declares none.`}
        >
          {null}
        </WidgetCard>
      );
    }
    return (
      <WidgetCard {...shared} isLoading>
        {null}
      </WidgetCard>
    );
  }

  if (!slot.ok) {
    return (
      <WidgetCard {...shared} error={slot.error} updatedAt={updatedAt}>
        {null}
      </WidgetCard>
    );
  }

  const outcome = body(slot.result, definition);
  if (!outcome.ok) {
    return (
      <WidgetCard {...shared} error={outcome.message} updatedAt={updatedAt}>
        {null}
      </WidgetCard>
    );
  }

  return (
    <WidgetCard {...shared} updatedAt={updatedAt}>
      {outcome.node}
    </WidgetCard>
  );
}
