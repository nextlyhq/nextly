"use client";

/**
 * The Design panel: the site's variables, shared styles and fonts, as three
 * tabs of one panel under one header.
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
import { EDITOR_WORDS } from "@nextlyhq/builder/shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@nextlyhq/ui";
import * as React from "react";

import { RemountOnStyleReplay } from "./site-style-history";

/**
 * The panel's tabs, in the order the rail's Design item shows them, named
 * with the editor's words.
 */
const DESIGN_VIEWS: ReadonlyArray<{
  readonly value: "variables" | "classes" | "fonts";
  readonly label: string;
}> = [
  { value: "variables", label: EDITOR_WORDS.variables },
  // Stored as "classes", the value it has always had, so a remembered tab
  // still opens; only the words changed.
  { value: "classes", label: EDITOR_WORDS.sharedStyles },
  { value: "fonts", label: EDITOR_WORDS.fonts },
];

export type DesignView = (typeof DESIGN_VIEWS)[number]["value"];

/**
 * The tab to show for a stored view. Anything this panel does not name — none
 * chosen yet, or one a later release dropped — opens on the first tab rather
 * than on no tab at all.
 */
export function designViewOf(view: string | null): DesignView {
  return DESIGN_VIEWS.find(entry => entry.value === view)?.value ?? "variables";
}

/**
 * Where the open tab may put controls of its own, in the panel's header beside
 * the title: the Variables tab's preview switch and import-and-export menu.
 * `null` until the header has mounted.
 */
const DesignHeaderSlot = React.createContext<HTMLElement | null>(null);

/** The header element the open tab can draw its own controls into. */
export function useDesignHeaderSlot(): HTMLElement | null {
  return React.useContext(DesignHeaderSlot);
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
  // State rather than a ref, so a tab reading the slot renders again once the
  // header element exists.
  const [slot, setSlot] = React.useState<HTMLElement | null>(null);
  // Drawn once per tab and per set of tabs: the header's own update above
  // re-renders this panel, and that is no reason to rebuild the open tab.
  const open = React.useMemo(() => tabs[current](), [tabs, current]);
  return (
    <section className="nx-pb-design" aria-label="Design panel">
      <Tabs
        value={current}
        onValueChange={view.choose}
        className="nx-pb-design__tabs-root"
      >
        <div className="nx-pb-design__head">
          <div className="nx-pb-design__title-row">
            <h2 className="nx-pb-design__title">Design</h2>
            <div className="nx-pb-design__actions" ref={setSlot} />
          </div>
          <TabsList aria-label="Design" className="nx-pb-design__tabs">
            {DESIGN_VIEWS.map(entry => (
              <TabsTrigger
                key={entry.value}
                value={entry.value}
                className="nx-pb-design__tab"
              >
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <DesignHeaderSlot.Provider value={slot}>
          {DESIGN_VIEWS.map(entry => (
            <TabsContent
              key={entry.value}
              value={entry.value}
              className="nx-pb-design__body"
            >
              {/* A style change undone or redone is written behind the open
                  tab's back, so the tab is mounted afresh to read it. */}
              {entry.value === current ? (
                <RemountOnStyleReplay>{open}</RemountOnStyleReplay>
              ) : null}
            </TabsContent>
          ))}
        </DesignHeaderSlot.Provider>
      </Tabs>
    </section>
  );
}
