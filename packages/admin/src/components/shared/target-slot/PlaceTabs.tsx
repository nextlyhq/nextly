"use client";

/**
 * A place's tabs: the page's own content, and every tab contributed there.
 *
 * With no tab delivered the page's content is drawn as it is, with no strip,
 * so a page that has no tabs today is unchanged. With one, the content is the
 * first tab, under the page's own label, and each contributed tab follows in
 * the order delivered, its component behind its own boundary.
 *
 * @module components/shared/target-slot/PlaceTabs
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@nextlyhq/ui";
import type { AdminPlaceId } from "nextly/config";
import type { ReactNode } from "react";

import { PluginSlot } from "@admin/components/shared/plugin-slot";

import type { PlaceContributionProps } from "./TargetSlot";
import { usePlaceContributions } from "./usePlaceContributions";

/** The value the page's own content takes in the strip; ids always hold a dot. */
const CONTENT_TAB = "content";

export interface PlaceTabsProps<P extends AdminPlaceId>
  extends PlaceContributionProps<P> {
  place: P;
  /** The page's own content's tab label, in the interface language. */
  contentLabel: string;
  children: ReactNode;
}

export function PlaceTabs<P extends AdminPlaceId>({
  place,
  context,
  entry,
  contentLabel,
  children,
}: PlaceTabsProps<P>): ReactNode {
  const tabs = usePlaceContributions(place, "tab", entry).filter(
    item => !("builtIn" in item) && item.kind === "tab"
  );
  if (tabs.length === 0) return children;
  return (
    <Tabs defaultValue={CONTENT_TAB}>
      <TabsList>
        <TabsTrigger value={CONTENT_TAB}>{contentLabel}</TabsTrigger>
        {tabs.map(tab =>
          "builtIn" in tab || tab.kind !== "tab" ? null : (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          )
        )}
      </TabsList>
      <TabsContent value={CONTENT_TAB}>{children}</TabsContent>
      {tabs.map(tab =>
        "builtIn" in tab || tab.kind !== "tab" ? null : (
          <TabsContent key={tab.id} value={tab.id}>
            <PluginSlot<PlaceContributionProps<P>>
              path={tab.component}
              props={{ context, ...(entry === undefined ? {} : { entry }) }}
            />
          </TabsContent>
        )
      )}
    </Tabs>
  );
}
