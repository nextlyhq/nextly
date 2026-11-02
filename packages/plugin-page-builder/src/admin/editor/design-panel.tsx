"use client";

/**
 * The Design panel: the site's variables, classes and fonts, as three tabs of
 * one panel.
 *
 * One place for the site's look rather than three rail items: an author
 * setting up a page's style moves between them, and three panels made each
 * move a trip back to the rail that also closed what they were looking at.
 *
 * Which tab shows is the shell's to keep, with its other preferences, so the
 * tab an author left is the one they come back to — and a request from
 * elsewhere (the fonts tab sending an author to fix a variable) can name the
 * tab along with the panel.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/design-panel
 */
import type { PanelView } from "@nextlyhq/builder";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@nextlyhq/ui";
import type * as React from "react";

/** The panel's tabs, in the order the rail's Design item shows them. */
const DESIGN_VIEWS = [
  { value: "variables", label: "Variables" },
  { value: "classes", label: "Classes" },
  { value: "fonts", label: "Fonts" },
] as const;

export type DesignView = (typeof DESIGN_VIEWS)[number]["value"];

/**
 * The tab to show for a stored view. Anything this panel does not name — none
 * chosen yet, or one a later release dropped — opens on the first tab rather
 * than on no tab at all.
 */
export function designViewOf(view: string | null): DesignView {
  return DESIGN_VIEWS.find(entry => entry.value === view)?.value ?? "variables";
}

export function DesignPanel({
  view,
  tabs,
}: {
  view: PanelView;
  /** What fills each tab. Only the open tab's content is mounted. */
  tabs: Record<DesignView, () => React.ReactNode>;
}): React.JSX.Element {
  const current = designViewOf(view.current);
  return (
    <Tabs value={current} onValueChange={view.choose}>
      <TabsList aria-label="Design">
        {DESIGN_VIEWS.map(entry => (
          <TabsTrigger key={entry.value} value={entry.value}>
            {entry.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {DESIGN_VIEWS.map(entry => (
        <TabsContent key={entry.value} value={entry.value}>
          {entry.value === current ? tabs[entry.value]() : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}
