"use client";

/**
 * Plugins' own items at the rail's foot, just above the Inbox.
 *
 * Such an item is a component that may draw nothing and only register what a
 * page needs, so it has to stay mounted on every page and at every width. The
 * rail it is seen in does not: below the width where the rail shows, the
 * rail is hidden and a copy of it opens in a drawer, and a surface that takes
 * the rail away draws the Inbox in the top bar instead.
 *
 * So the items are rendered once, by `RailFootPluginItemsProvider`, into an
 * element of their own, and only that element moves: into the foot that was
 * mounted last (the drawer's while it is open, the bar's while the rail is
 * taken away, the rail's otherwise). Moving an element does not remount what
 * React drew into it, so the items keep their state and their effects.
 *
 * @module components/layout/sidebar/RailFootPluginItems
 */
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { useBranding } from "@admin/context/providers/BrandingProvider";

import { pluginHeaderItems } from "../header/header-visibility";

interface RailFootValue {
  /** Offer a foot to draw the items in; the last one offered is used. */
  offer: (target: HTMLElement) => () => void;
}

const RailFootContext = createContext<RailFootValue | null>(null);

/** The element the items are drawn into, laid out as if it were not there. */
function createHost(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const host = document.createElement("div");
  host.style.display = "contents";
  host.dataset.testid = "rail-foot-plugin-items";
  return host;
}

/** Put `host` into the last foot offered, or take it out of the page. */
function placeHost(host: HTMLElement, targets: readonly HTMLElement[]): void {
  const target = targets.at(-1);
  if (target === undefined) host.remove();
  else if (host.parentElement !== target) target.prepend(host);
}

/**
 * Renders the plugins' rail-foot items once, for as long as this is mounted,
 * and moves them into whichever foot is showing. Above every rail and the bar.
 */
export function RailFootPluginItemsProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [host] = useState(createHost);
  const [targets, setTargets] = useState<readonly HTMLElement[]>([]);
  const offer = useCallback((target: HTMLElement) => {
    setTargets(current => [...current.filter(t => t !== target), target]);
    return () => setTargets(current => current.filter(t => t !== target));
  }, []);
  const value = useMemo(() => ({ offer }), [offer]);
  useLayoutEffect(() => {
    if (host) placeHost(host, targets);
  }, [host, targets]);
  return (
    <RailFootContext.Provider value={value}>
      {children}
      {host && createPortal(<RailFootItems />, host)}
    </RailFootContext.Provider>
  );
}

function RailFootItems(): JSX.Element {
  const items = pluginHeaderItems(useBranding()?.plugins, "rail-foot");
  return (
    <>
      {items.map(item => (
        <PluginSlot key={item.name} path={item.slot} />
      ))}
    </>
  );
}

/**
 * Where a foot takes the plugins' items: first in it, so they come before the
 * Inbox in the foot's order and in the tab order. Nothing outside the
 * provider.
 */
export function RailFootPluginPlace(): JSX.Element | null {
  const foot = useContext(RailFootContext);
  const offer = foot?.offer;
  const ref = useCallback(
    (element: HTMLElement | null) =>
      element && offer ? offer(element) : undefined,
    [offer]
  );
  if (!foot) return null;
  return <div ref={ref} className="contents" />;
}
