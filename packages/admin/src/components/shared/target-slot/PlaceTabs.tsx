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
 * A contributed tab's panel is mounted with the page and stays mounted while
 * another tab is shown, only hidden, so its own state survives a switch and
 * it can keep the count beside its label (`setBadge`) current while closed.
 * It is hidden with the panel's `hidden` attribute rather than `Activity`,
 * which would stop its effects, and with them the count.
 *
 * Which tab is open is the strip's own until a page takes it over with
 * `openTab` and `onOpenTabChange`, as the edit pages do to keep it in the
 * address. A shown tab that is no longer delivered gives the content back.
 * Nothing contributed is drawn while the page's context is `null`.
 *
 * @module components/shared/target-slot/PlaceTabs
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@nextlyhq/ui";
import type { AdminPlaceId } from "nextly/config";
import {
  Activity,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { useT } from "@admin/lib/i18n/I18nProvider";
import { cn } from "@admin/lib/utils";

import { IsolatedContribution } from "./IsolatedContribution";
import { PlaceContributionFallback } from "./PlaceContributionFallback";
import type { PlaceContributionProps, PlaceProps } from "./TargetSlot";
import { usePlaceContributions } from "./usePlaceContributions";

/** The value the page's own content takes in the strip; ids always hold a dot. */
const CONTENT_TAB = "content";

/** The highest count drawn in full; a larger one reads "99+". */
const LARGEST_DRAWN_COUNT = 99;

/**
 * @experimental A count a contributed tab shows beside its label, such as how
 * many things on the page need attention.
 */
export interface PlaceTabBadge {
  /** The number drawn beside the tab's label: a whole number from zero. */
  count: number;
  /**
   * What the count means, in words, read with the tab's name by a screen
   * reader and shown when the count is pointed at: "3 things to fix".
   */
  label: string;
  /**
   * `"attention"` draws a count above zero in the warning colour, for
   * something the reader should act on; `"neutral"`, the default, in a muted
   * one.
   */
  tone?: "neutral" | "attention";
}

/** What every tab contributed to a place receives. */
export interface PlaceTabProps<P extends AdminPlaceId = AdminPlaceId>
  extends PlaceContributionProps<P> {
  /**
   * Show a count beside the tab's label, or none with `null`. The tab's own
   * count, kept until it is changed or the tab is no longer drawn. The same
   * function for as long as the tab is drawn, so an effect may name it.
   */
  setBadge: (badge: PlaceTabBadge | null) => void;
}

export interface PlaceTabsProps<P extends AdminPlaceId> extends PlaceProps<P> {
  /** The page's own content's tab label, in the interface language. */
  contentLabel: string;
  /**
   * Classes for the strip and the contributed tabs' panels, never the page's
   * own content, which keeps its own layout: where the page insets its
   * content, the strip and a plugin's panel line up with it.
   */
  className?: string;
  /**
   * What each contributed tab's component is handed besides `PlaceTabProps`,
   * such as the form an edit page's tab writes through. A record rather than
   * a type parameter: a tab is loaded by its path, so nothing here can check
   * the component against it, and the page that passes it names the exact
   * shape its tabs are promised (`DocumentTabProps` for the edit pages).
   */
  tabProps?: Readonly<Record<string, unknown>>;
  /**
   * The open tab, where the page keeps it: a contributed tab's id, or `null`
   * for the page's own content. One naming a tab not delivered shows the
   * content. Left out, the strip keeps it.
   */
  openTab?: string | null;
  /** Told the tab the reader opens, by the same values `openTab` takes. */
  onOpenTabChange?: (tab: string | null) => void;
  children: ReactNode;
}

/** Whether two badges say the same, so an unchanged one sets nothing. */
function sameBadge(
  a: PlaceTabBadge | undefined,
  b: PlaceTabBadge | null
): boolean {
  if (a === undefined || b === null) return a === undefined && b === null;
  return (
    a.count === b.count &&
    a.label === b.label &&
    (a.tone ?? "neutral") === (b.tone ?? "neutral")
  );
}

/**
 * A badge as the strip draws it, or none: a plugin's count is its own code's
 * value, so anything that is not a whole number from zero draws nothing
 * rather than a broken pill.
 */
function drawnBadge(
  badge: PlaceTabBadge | undefined
): PlaceTabBadge | undefined {
  if (badge === undefined) return undefined;
  return Number.isInteger(badge.count) && badge.count >= 0 ? badge : undefined;
}

/**
 * Each tab's badge, and the one `setBadge` each tab is handed, the same
 * function for as long as the strip is mounted, so a tab may name it in an
 * effect's dependencies without running the effect on every render.
 */
function useTabBadges(): {
  badges: Readonly<Record<string, PlaceTabBadge>>;
  setterFor: (id: string) => PlaceTabProps["setBadge"];
} {
  const [badges, setBadges] = useState<Record<string, PlaceTabBadge>>({});
  const setters = useRef(new Map<string, PlaceTabProps["setBadge"]>());
  const setterFor = useCallback((id: string) => {
    let setter = setters.current.get(id);
    if (setter === undefined) {
      setter = badge =>
        setBadges(current => {
          if (sameBadge(current[id], badge)) return current;
          if (badge !== null) return { ...current, [id]: badge };
          return Object.fromEntries(
            Object.entries(current).filter(([key]) => key !== id)
          );
        });
      setters.current.set(id, setter);
    }
    return setter;
  }, []);
  return { badges, setterFor };
}

/**
 * Which tab is shown, and the handler the strip calls when one is chosen.
 *
 * The strip keeps the choice unless the page passes `openTab`. A tab chosen
 * here and no longer delivered is let go of, rather than only not shown:
 * kept, it would take the page away again the moment it came back. That is
 * set while rendering, as React's derived-state pattern allows. A page that
 * keeps the open tab decides that itself: an address naming a tab before the
 * tabs have arrived must still open it once they do.
 */
function useShownTab(
  ids: readonly string[],
  openTab: string | null | undefined,
  onOpenTabChange: ((tab: string | null) => void) | undefined
): { shown: string; choose: (value: string) => void } {
  const [chosen, setChosen] = useState(CONTENT_TAB);
  const controlled = openTab !== undefined;
  if (!controlled && chosen !== CONTENT_TAB && !ids.includes(chosen)) {
    setChosen(CONTENT_TAB);
  }
  const wanted = controlled ? (openTab ?? CONTENT_TAB) : chosen;
  const choose = (value: string) => {
    if (!controlled) setChosen(value);
    onOpenTabChange?.(value === CONTENT_TAB ? null : value);
  };
  return { shown: ids.includes(wanted) ? wanted : CONTENT_TAB, choose };
}

export function PlaceTabs<P extends AdminPlaceId>({
  place,
  context,
  entry,
  contentLabel,
  className,
  tabProps,
  openTab,
  onOpenTabChange,
  children,
}: PlaceTabsProps<P>): ReactNode {
  const delivered = usePlaceContributions(place, "tab", { context, entry });
  const { badges, setterFor } = useTabBadges();
  const tabs =
    context === null
      ? []
      : delivered.flatMap(item =>
          "builtIn" in item || item.kind !== "tab" ? [] : [item]
        );
  const { shown, choose } = useShownTab(
    tabs.map(tab => tab.id),
    openTab,
    onOpenTabChange
  );
  return (
    <>
      {context === null || tabs.length === 0 ? null : (
        <Tabs
          value={shown}
          onValueChange={choose}
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
              <PlaceTabTrigger
                key={tab.id}
                value={tab.id}
                label={tab.label}
                badge={drawnBadge(badges[tab.id])}
              />
            ))}
          </TabsList>
          {tabs.map(tab => (
            <PlaceTabPanel<P>
              key={tab.id}
              id={tab.id}
              component={tab.component}
              open={shown === tab.id}
              props={{
                ...tabProps,
                context,
                ...(entry === undefined ? {} : { entry }),
                setBadge: setterFor(tab.id),
              }}
            />
          ))}
        </Tabs>
      )}
      <Activity mode={shown === CONTENT_TAB ? "visible" : "hidden"}>
        {children}
      </Activity>
    </>
  );
}

/**
 * One contributed tab's panel: mounted while closed, and hidden by its
 * `hidden` attribute, which a mounted panel otherwise never carries, with
 * its component behind its own boundary.
 */
function PlaceTabPanel<P extends AdminPlaceId>({
  id,
  component,
  open,
  props,
}: {
  id: string;
  component: string;
  open: boolean;
  props: PlaceTabProps<P> & Readonly<Record<string, unknown>>;
}): ReactNode {
  return (
    <TabsContent value={id} forceMount hidden={!open}>
      <PlaceTabBody setBadge={props.setBadge}>
        <IsolatedContribution>
          <PluginSlot<PlaceTabProps<P> & Readonly<Record<string, unknown>>>
            path={component}
            fallback={<PlaceContributionFallback />}
            props={props}
          />
        </IsolatedContribution>
      </PlaceTabBody>
    </TabsContent>
  );
}

/**
 * One contributed tab in the strip: its label, and its count when it has one.
 * The count is drawn for sight and said in words, with the label, as the
 * tab's name, so a screen reader hears "SEO (3 things to fix)" rather than
 * "SEO 3".
 */
function PlaceTabTrigger({
  value,
  label,
  badge,
}: {
  value: string;
  label: string;
  badge: PlaceTabBadge | undefined;
}): ReactNode {
  const t = useT();
  // The warning colour only while there is something to act on: an
  // alarm-coloured zero asks for attention it does not need.
  const attention = badge?.tone === "attention" && badge.count > 0;
  return (
    <TabsTrigger
      value={value}
      {...(badge === undefined
        ? {}
        : {
            "aria-label": t("nextly.places.tabWithBadge", {
              tab: label,
              badge: badge.label,
            }),
          })}
    >
      {label}
      {badge === undefined ? null : (
        <span
          aria-hidden="true"
          title={badge.label}
          data-tab-badge={attention ? "attention" : "neutral"}
          className={cn(
            "ml-2 inline-flex min-w-5 justify-center rounded-full px-1.5 text-xs font-medium tabular-nums leading-5",
            attention
              ? "bg-warning-100 text-warning-700 dark:bg-warning-900 dark:text-warning-100"
              : "bg-muted text-muted-foreground"
          )}
        >
          {badge.count > LARGEST_DRAWN_COUNT
            ? t("nextly.places.tabBadgeOverflow", {
                count: LARGEST_DRAWN_COUNT,
              })
            : badge.count}
        </span>
      )}
    </TabsTrigger>
  );
}

/**
 * A contributed tab's panel body. Its badge is taken back as it unmounts, so
 * a tab no longer delivered leaves no count behind should it come back.
 */
function PlaceTabBody({
  setBadge,
  children,
}: {
  setBadge: PlaceTabProps["setBadge"];
  children: ReactNode;
}): ReactNode {
  useEffect(() => () => setBadge(null), [setBadge]);
  return children;
}
