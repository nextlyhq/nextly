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
import { cn } from "@nextlyhq/ui/utils";
import {
  Blocks,
  CircleHelp,
  FileText,
  Layers,
  Palette,
  Plus,
  Settings,
} from "lucide-react";
import type * as React from "react";

import { EDITOR_WORDS } from "./editor-words";
import { RAIL_GROUPS, RAIL_WIDTH, type LeftPanel } from "./shell-state";

/** Each panel's name, from the editor's words, and its icon, side by side. */
const PANEL_CHROME: Record<
  LeftPanel,
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  add: { label: EDITOR_WORDS.add, Icon: Plus },
  layers: { label: EDITOR_WORDS.layers, Icon: Layers },
  pages: { label: EDITOR_WORDS.pages, Icon: FileText },
  components: { label: EDITOR_WORDS.components, Icon: Blocks },
  design: { label: EDITOR_WORDS.design, Icon: Palette },
  settings: { label: EDITOR_WORDS.settings, Icon: Settings },
};

/** A panel's name, as the rail shows it and the open panel's region is named. */
export function panelLabel(panel: LeftPanel): string {
  return PANEL_CHROME[panel].label;
}

// The ring sits off the item by a gap of the rail's own surface: on the open
// panel's item, filled with the accent, a ring drawn against the fill is the
// same colour as it and does not show.
const ITEM_CLASS =
  "focus-visible:ring-ring flex w-full flex-col items-center gap-1 rounded-md py-1.5 text-xs leading-tight focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--nx-builder-surface)] focus-visible:outline-none";

function RailItem({
  label,
  Icon,
  pressed,
  onClick,
  ...data
}: {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  pressed?: boolean;
  onClick: (button: HTMLElement) => void;
} & Record<`data-${string}`, string>) {
  return (
    <button
      type="button"
      data-builder-animates
      aria-pressed={pressed}
      onClick={event => onClick(event.currentTarget)}
      className={cn(
        ITEM_CLASS,
        pressed === true
          ? "bg-[color:var(--nx-builder-accent)] text-[color:var(--nx-builder-accent-text)]"
          : "text-[color:var(--nx-builder-text-muted)]"
      )}
      {...data}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span>{label}</span>
    </button>
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
  const item = (panel: LeftPanel) => {
    const { label, Icon } = PANEL_CHROME[panel];
    return (
      <li key={panel}>
        <RailItem
          label={label}
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
      className="border-[color:var(--nx-builder-border)] flex shrink-0 flex-col border-r px-1 py-2"
    >
      <ul className="flex flex-col gap-1">
        {RAIL_GROUPS.top.filter(isAvailable).map(item)}
      </ul>
      <ul className="mt-auto flex flex-col gap-1">
        {RAIL_GROUPS.bottom.filter(isAvailable).map(item)}
        {onSettings === undefined ? null : (
          <li>
            <RailItem
              label={PANEL_CHROME.settings.label}
              Icon={PANEL_CHROME.settings.Icon}
              pressed={settingsOpen}
              onClick={onSettings}
              data-rail-action="settings"
            />
          </li>
        )}
        <li>
          <RailItem
            label={EDITOR_WORDS.help}
            Icon={CircleHelp}
            onClick={onHelp}
            data-rail-action="help"
          />
        </li>
      </ul>
    </nav>
  );
}
