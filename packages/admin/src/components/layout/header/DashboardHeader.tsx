import type { JSX } from "react";

import { PanelLeftClose, PanelLeftOpen } from "@admin/components/icons";
import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { cn } from "@admin/lib/utils";

import { usePanelFold } from "../PanelFold";

import { pluginHeaderItems } from "./header-visibility";
import { HeaderTrail, useHasHeaderTrail } from "./HeaderTrail";

interface DashboardHeaderProps {
  className?: string;
}

/**
 * The admin's top bar: the page's own place, and nothing global.
 *
 * It holds the trail the page on screen registered (such as an open
 * document's place under Content) and, on a page that started its panel
 * folded, the toggle that brings the panel back. The reader's Inbox and
 * account menu are at the foot of the icon rail, and Docs, GitHub, Discord and
 * the theme are in that menu. A plugin's own header item (`header.slot`) stays
 * at the bar's right end, on every page, where plugins have always put it:
 * some draw a button there, and some draw nothing and register what a page
 * needs, so it is mounted for as long as the bar is.
 *
 * Below the width where the rail shows, the phone header above it already
 * holds the logo and the menu, so the bar is drawn only while it has a trail,
 * the panel toggle or a plugin's item to show, rather than as an empty band. Both are
 * declared in layout effects, so this is settled before the first paint.
 */
export function DashboardHeader({
  className,
}: DashboardHeaderProps): JSX.Element {
  const hasTrail = useHasHeaderTrail();
  const { declared } = usePanelFold();
  const pluginItems = pluginHeaderItems(useBranding()?.plugins);
  const empty = !hasTrail && !declared && pluginItems.length === 0;
  return (
    <header
      data-empty={empty || undefined}
      className={cn(
        "h-16 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40 w-full",
        "flex items-center px-6",
        // A container, so the trail answers to the bar's own width: a sidebar
        // narrows it as much as a small window does.
        "@container/topbar",
        empty && "max-lg:hidden",
        className
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <PanelFoldToggle />
        <HeaderTrail />
      </div>
      {pluginItems.length > 0 && (
        <div
          className="flex shrink-0 items-center gap-1"
          data-testid="plugin-header-items"
        >
          {pluginItems.map(item => (
            <PluginSlot key={item.name} path={item.slot} />
          ))}
        </div>
      )}
    </header>
  );
}

/**
 * The panel toggle, at the bar's left end, on a page that started its panel
 * folded. Nothing on any other page: there the panel follows the rail.
 */
function PanelFoldToggle(): JSX.Element | null {
  const { declared, open, toggle } = usePanelFold();
  if (!declared) return null;
  const Icon = open ? PanelLeftClose : PanelLeftOpen;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={open}
      aria-label={open ? "Hide the panel" : "Show the panel"}
      title={open ? "Hide the panel" : "Show the panel"}
      className="-ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
