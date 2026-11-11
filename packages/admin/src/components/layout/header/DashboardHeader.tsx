import type { JSX } from "react";

import { Menu, PanelLeftClose, PanelLeftOpen } from "@admin/components/icons";
import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { cn } from "@admin/lib/utils";

import { useSuppressedChrome } from "../ChromeSuppression";
import { usePanelFold } from "../PanelFold";
import { RailAccount } from "../sidebar/RailAccount";

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
 * A surface that takes the rail away but keeps the bar (translation mode)
 * would take the Inbox and the account menu with it, so while the rail is
 * suppressed they are drawn at the bar's right end instead.
 *
 * Its height is `--admin-bar-height`, which whatever measures against the bar
 * reads too.
 */
export function DashboardHeader({
  className,
  onOpenMenu,
}: DashboardHeaderProps): JSX.Element {
  const pluginItems = pluginHeaderItems(useBranding()?.plugins);
  const railSuppressed = useSuppressedChrome().has("primaryRail");
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
      {/* The page's place keeps its own width, at most half the bar, and
          gives way first; the right part takes the rest, so an open
          document's status sits right after the trail and its actions at the
          bar's right end. */}
      <div className="flex min-w-0 max-w-1/2 items-center gap-4">
        <PanelFoldToggle />
        <HeaderTrail />
        <TopBarPlaceTarget
          name="start"
          className="flex min-w-0 items-center empty:hidden"
        />
      </div>
      <TopBarPlaceTarget
        name="end"
        // The `toolbar` container: an open document's controls size themselves
        // against the room this part actually has, after the trail, as they did
        // against a bar of their own. Its width comes from the bar, not from
        // its content, so it can be one.
        className="@container/toolbar flex min-w-0 flex-1 items-center justify-end gap-2 empty:hidden"
      />
      {pluginItems.length > 0 && (
        <div
          className="ml-auto flex shrink-0 items-center gap-1"
          data-testid="plugin-header-items"
        >
          {pluginItems.map(item => (
            <PluginSlot key={item.name} path={item.slot} />
          ))}
        </div>
      )}
      {railSuppressed && <RailAccount placement="bar" />}
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
