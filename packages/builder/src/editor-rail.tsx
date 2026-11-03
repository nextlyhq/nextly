/**
 * The editor's left rail: the daily tools at the top, Settings and Help at the
 * bottom, each with its name under its icon.
 *
 * Named, not icon-only: an author new to the editor should not have to hover
 * every icon to find Layers. And a panel the host cannot fill yet is left out
 * rather than drawn disabled, so the rail only ever offers what works; it
 * grows as the panels behind it are built.
 *
 * @module editor-rail
 */
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useShortcuts,
} from "@nextlyhq/ui";
import { cn } from "@nextlyhq/ui/utils";
import {
  CircleHelp,
  Component,
  Files,
  Layers,
  Palette,
  Plus,
  Settings,
} from "lucide-react";
import type * as React from "react";

import { EDITOR_WORDS } from "./editor-words";
import { RAIL_GROUPS, RAIL_WIDTH, type LeftPanel } from "./shell-state";

/**
 * Each panel's name, from the editor's words, its icon, and the single key
 * that opens it (as in Webflow and Framer). The keys fire only when nothing is
 * being typed and no modifier is held; none of them is another shortcut's.
 */
const PANEL_CHROME: Record<
  LeftPanel,
  {
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
    key?: string;
  }
> = {
  add: { label: EDITOR_WORDS.add, Icon: Plus, key: "a" },
  layers: { label: EDITOR_WORDS.layers, Icon: Layers, key: "l" },
  pages: { label: EDITOR_WORDS.pages, Icon: Files, key: "p" },
  components: { label: EDITOR_WORDS.components, Icon: Component, key: "c" },
  design: { label: EDITOR_WORDS.design, Icon: Palette, key: "d" },
  settings: { label: EDITOR_WORDS.settings, Icon: Settings },
};

/** A panel's name, as the rail shows it and the open panel's region is named. */
export function panelLabel(panel: LeftPanel): string {
  return PANEL_CHROME[panel].label;
}

// A 36px square holding the icon alone; its name is its tooltip and its
// accessible name. The ring sits off the item by a gap of the rail's own
// surface: on the open panel's item, filled with the accent, a ring drawn
// against the fill is the same colour as it and does not show.
const ITEM_CLASS =
  "focus-visible:ring-ring inline-flex size-9 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--nx-builder-surface)] focus-visible:outline-none";

function RailItem({
  label,
  shortcut,
  Icon,
  pressed,
  onClick,
  ...data
}: {
  label: string;
  /** The single key that opens it, shown in its tooltip. */
  shortcut?: string;
  Icon: React.ComponentType<{ className?: string }>;
  pressed?: boolean;
  onClick: (button: HTMLElement) => void;
} & Record<`data-${string}`, string>) {
  const key = shortcut?.toUpperCase();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-builder-animates
          aria-pressed={pressed}
          aria-label={label}
          {...(key === undefined ? {} : { "aria-keyshortcuts": key })}
          onClick={event => onClick(event.currentTarget)}
          className={cn(
            ITEM_CLASS,
            pressed === true
              ? "bg-[color:var(--nx-builder-accent)] text-[color:var(--nx-builder-accent-text)]"
              : "text-[color:var(--nx-builder-text-muted)] hover:bg-[color:var(--nx-builder-surface-raised)]"
          )}
          {...data}
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="flex items-center gap-2">
        <span>{label}</span>
        {key === undefined ? null : (
          <kbd className="rounded border border-border px-1 font-mono text-[11px] text-muted-foreground">
            {key}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The panels' single keys: each opens its panel, or closes it when it is the
 * one open, as clicking its item does. Never while text is being typed and
 * never with a modifier held, so an author typing on the canvas or in a field
 * never switches panels.
 */
function usePanelKeys(
  panels: readonly LeftPanel[],
  onSelect: (panel: LeftPanel) => void
): void {
  useShortcuts(
    panels.flatMap(panel => {
      const { label, key } = PANEL_CHROME[panel];
      return key === undefined
        ? []
        : [
            {
              keys: key,
              description: `Open or close ${label}`,
              whenTyping: false,
              run: () => onSelect(panel),
            },
          ];
    }),
    { name: "Editor panels" }
  );
}

export interface EditorRailProps {
  /** The panel open now, or none. */
  openPanel: LeftPanel | null;
  /** Whether the host can fill a panel; one it cannot is not offered. */
  isAvailable: (panel: LeftPanel) => boolean;
  /** A rail item was chosen. */
  onSelect: (panel: LeftPanel) => void;
  /** Help was chosen, from this button, which focus returns to. */
  onHelp: (button: HTMLElement) => void;
  /** The rail's own element, for region navigation. */
  railRef: (element: HTMLElement | null) => void;
  /**
   * Settings was chosen, from this button, which focus returns to: the host's
   * Settings dialog. Absent, Settings is a panel like the others, offered
   * where the host can fill it.
   */
  onSettings?: (button: HTMLElement) => void;
  /** Whether the Settings dialog is open, shown as the item pressed. */
  settingsOpen?: boolean;
}

export function EditorRail({
  openPanel,
  isAvailable,
  onSelect,
  onHelp,
  railRef,
  onSettings,
  settingsOpen = false,
}: EditorRailProps): React.JSX.Element {
  usePanelKeys(
    [...RAIL_GROUPS.top, ...RAIL_GROUPS.bottom].filter(isAvailable),
    onSelect
  );
  const item = (panel: LeftPanel) => {
    const { label, Icon, key } = PANEL_CHROME[panel];
    return (
      <li key={panel} className="flex justify-center">
        <RailItem
          label={label}
          {...(key === undefined ? {} : { shortcut: key })}
          Icon={Icon}
          pressed={openPanel === panel}
          onClick={() => onSelect(panel)}
          data-panel={panel}
        />
      </li>
    );
  };
  return (
    <nav
      ref={railRef}
      tabIndex={-1}
      aria-label="Editor panels"
      style={{ width: RAIL_WIDTH }}
      className="border-[color:var(--nx-builder-border)] flex shrink-0 flex-col border-r py-2"
    >
      {/* One provider for the rail's tooltips, so moving from item to item
          shows the next name at once. */}
      <TooltipProvider delayDuration={300}>
        <ul className="flex flex-col gap-1">
          {RAIL_GROUPS.top.filter(isAvailable).map(item)}
        </ul>
        <ul className="mt-auto flex flex-col gap-1">
          {RAIL_GROUPS.bottom.filter(isAvailable).map(item)}
          {onSettings === undefined ? null : (
            <li className="flex justify-center">
              <RailItem
                label={PANEL_CHROME.settings.label}
                Icon={PANEL_CHROME.settings.Icon}
                pressed={settingsOpen}
                onClick={onSettings}
                data-rail-action="settings"
              />
            </li>
          )}
          <li className="flex justify-center">
            <RailItem
              label={EDITOR_WORDS.help}
              Icon={CircleHelp}
              onClick={onHelp}
              data-rail-action="help"
            />
          </li>
        </ul>
      </TooltipProvider>
    </nav>
  );
}
