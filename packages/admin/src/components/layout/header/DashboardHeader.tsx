import type { JSX } from "react";

import {
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
} from "@admin/components/icons";
import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { cn } from "@admin/lib/utils";

import { usePanelFold } from "../PanelFold";

import { pluginHeaderItems } from "./header-visibility";
import { HeaderTrail } from "./HeaderTrail";
import { TopBarPlaceTarget } from "./TopBarPlaces";

interface DashboardHeaderProps {
  className?: string;
  /** Opens the navigation drawer, below the width where the rail shows. */
  onOpenMenu?: () => void;
}

/**
 * The admin's one top bar: the page's own place, and nothing global.
 *
 * Its left part says where the page is: the trail an open document registered,
 * or the breadcrumb the page drew into the bar's `start` place. Its right part,
 * the `end` place, holds the page's own actions. On a page that started its
 * panel folded, the toggle that brings the panel back comes first, and below
 * the width where the rail shows, the menu button that opens it in a drawer
 * comes before that. The reader's Inbox and account menu are at the foot of the
 * icon rail, so the bar's width belongs to the page, save for one thing: a
 * plugin's own header item (`header.slot`) stays at the bar's far right, on
 * every page, where plugins have always put it. Some draw a button there, and
 * some draw nothing and register what a page needs, so it is mounted for as
 * long as the bar is.
 *
 * Its height is `--admin-bar-height`, which whatever measures against the bar
 * reads too.
 */
export function DashboardHeader({
  className,
  onOpenMenu,
}: DashboardHeaderProps): JSX.Element {
  const pluginItems = pluginHeaderItems(useBranding()?.plugins);
  return (
    <header
      className={cn(
        "h-(--admin-bar-height) shrink-0 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40 w-full",
        "flex items-center gap-3 px-6 max-lg:px-3",
        // A container, so the trail answers to the bar's own width: a sidebar
        // narrows it as much as a small window does.
        "@container/topbar",
        className
      )}
    >
      {onOpenMenu && (
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open the navigation menu"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <PanelFoldToggle />
        <HeaderTrail />
        <TopBarPlaceTarget
          name="start"
          className="flex min-w-0 items-center empty:hidden"
        />
      </div>
      <TopBarPlaceTarget
        name="end"
        className="flex shrink-0 items-center gap-2 empty:hidden"
      />
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
