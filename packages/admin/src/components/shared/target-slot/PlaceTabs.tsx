"use client";

/**
 * A place's tabs: the page's own content, and every tab contributed there.
 *
 * With no tab delivered the page's content is drawn as it is, with no strip,
 * so a page that has no tabs today is unchanged. With one, the content is the
 * first tab, under the page's own label, and each contributed tab follows in
 * the order delivered, its component behind its own boundary.
 *
 * The page's content keeps one place in the tree whether a tab is delivered
 * or not, and is only hidden, never unmounted, while a plugin's tab is shown:
 * it holds the page's form, so tabs arriving with the admin metadata, a tab
 * being shown, or the last tab going away must all keep what was typed, and
 * the page's own Save button must still find its form. `Activity` hides it
 * without a wrapper, so a page with no tab has the same DOM as before.
 *
 * A shown tab that is no longer delivered gives the content back. Nothing
 * contributed is drawn while the page's context is `null`.
 *
 * @module components/shared/target-slot/PlaceTabs
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@nextlyhq/ui";
import type { AdminPlaceId } from "nextly/config";
import { Activity, useState, type ReactNode } from "react";

import { PluginSlot } from "@admin/components/shared/plugin-slot";

import { IsolatedContribution } from "./IsolatedContribution";
import { PlaceContributionFallback } from "./PlaceContributionFallback";
import type { PlaceContributionProps, PlaceProps } from "./TargetSlot";
import { usePlaceContributions } from "./usePlaceContributions";

/** The value the page's own content takes in the strip; ids always hold a dot. */
const CONTENT_TAB = "content";

export interface PlaceTabsProps<P extends AdminPlaceId> extends PlaceProps<P> {
  /** The page's own content's tab label, in the interface language. */
  contentLabel: string;
  /**
   * Classes for the strip and the contributed tabs' panels, never the page's
   * own content, which keeps its own layout: where the page insets its
   * content, the strip and a plugin's panel line up with it.
   */
  className?: string;
  children: ReactNode;
}

export function PlaceTabs<P extends AdminPlaceId>({
  place,
  context,
  entry,
  contentLabel,
  className,
  children,
}: PlaceTabsProps<P>): ReactNode {
  const delivered = usePlaceContributions(place, "tab", { context, entry });
  const [chosen, setChosen] = useState(CONTENT_TAB);
  const tabs =
    context === null
      ? []
      : delivered.flatMap(item =>
          "builtIn" in item || item.kind !== "tab" ? [] : [item]
        );
  // A chosen tab no longer delivered is let go of, rather than only not
  // shown: kept, it would take the page away again the moment it came back.
  // Set while rendering, as React's derived-state pattern allows.
  if (chosen !== CONTENT_TAB && !tabs.some(tab => tab.id === chosen)) {
    setChosen(CONTENT_TAB);
  }
  const shown = tabs.some(tab => tab.id === chosen) ? chosen : CONTENT_TAB;
  return (
    <>
      {context === null || tabs.length === 0 ? null : (
        <Tabs
          value={shown}
          onValueChange={setChosen}
          {...(className === undefined ? {} : { className })}
        >
          <TabsList scrollable>
            {/* The page's content is not one of the strip's panels, since
                wrapping it in one would change the page with no tab or
                remount it when a tab arrives, so this tab names no panel. */}
            <TabsTrigger value={CONTENT_TAB} aria-controls={undefined}>
              {contentLabel}
            </TabsTrigger>
            {tabs.map(tab => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map(tab => (
            <TabsContent key={tab.id} value={tab.id}>
              <IsolatedContribution>
                <PluginSlot<PlaceContributionProps<P>>
                  path={tab.component}
                  fallback={<PlaceContributionFallback />}
                  props={{ context, ...(entry === undefined ? {} : { entry }) }}
                />
              </IsolatedContribution>
            </TabsContent>
          ))}
        </Tabs>
      )}
      <Activity mode={shown === CONTENT_TAB ? "visible" : "hidden"}>
        {children}
      </Activity>
    </>
  );
}
