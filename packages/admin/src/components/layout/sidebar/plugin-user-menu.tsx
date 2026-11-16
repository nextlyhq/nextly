"use client";

/**
 * Plugins' declared items in the person's menu, under "Help and community",
 * and what activating one does.
 *
 * An item is data, never a component: the menu's contents are mounted only
 * while it is open. A link goes to an admin path in place or to an absolute
 * URL in a new tab, as the help links beside it do. An action runs through the
 * runner the entry list's declared actions use, on no rows: one that calls the
 * plugin's route says it ran, and one that opens the plugin's component is
 * drawn in a dialog outside the menu, which has closed by then.
 *
 * @module components/layout/sidebar/plugin-user-menu
 */
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenuItem,
} from "@nextlyhq/ui";
import { useCallback, useRef, useState, type JSX } from "react";

import { runDeclaredAction } from "@admin/components/features/entries/EntryList/declared-actions";
import { resolveIconName } from "@admin/components/features/widgets/archetypes/icon";
import { ExternalLink, Puzzle } from "@admin/components/icons";
import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { isExternalHref, Link } from "@admin/components/ui/link";
import { toast } from "@admin/components/ui/toaster";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";

import type { PluginUserMenuEntry } from "../header/header-visibility";

/** The item's icon, spaced as the help links' icons are; a plugin's when unknown. */
function ItemIcon({ name }: { name: string }): JSX.Element {
  return (
    <span className="mr-2 flex" aria-hidden="true">
      {resolveIconName(name) ?? <Puzzle className="h-4 w-4" />}
    </span>
  );
}

/** A link item: an admin path in place, an absolute URL in a new tab. */
function LinkItem({
  item,
  to,
}: {
  item: PluginUserMenuEntry;
  to: string;
}): JSX.Element {
  const external = isExternalHref(to);
  return (
    <DropdownMenuItem asChild className="cursor-pointer text-sm">
      <Link
        href={to}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        <ItemIcon name={item.icon} />
        {item.label}
        {external && (
          <ExternalLink
            className="ml-auto h-3.5 w-3.5 text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </Link>
    </DropdownMenuItem>
  );
}

/** The plugins' items, each a real menu item: choosing one closes the menu. */
export function PluginUserMenuItems({
  items,
  onAction,
}: {
  items: readonly PluginUserMenuEntry[];
  onAction: (item: PluginUserMenuEntry) => void;
}): JSX.Element {
  return (
    <>
      {items.map(item =>
        item.to === undefined ? (
          <DropdownMenuItem
            key={item.plugin}
            className="cursor-pointer text-sm"
            onSelect={() => onAction(item)}
          >
            <ItemIcon name={item.icon} />
            {item.label}
          </DropdownMenuItem>
        ) : (
          <LinkItem key={item.plugin} item={item} to={item.to} />
        )
      )}
    </>
  );
}

/** A component an item's action opened: what to draw, and its title. */
export interface OpenedMenuAction {
  label: string;
  component: string;
}

/** Run `item`'s action on no rows; what it opened, if anything. */
async function runMenuAction(
  item: PluginUserMenuEntry
): Promise<OpenedMenuAction | null> {
  if (item.action === undefined) return null;
  const outcome = await runDeclaredAction(
    { plugin: item.plugin, id: item.id, action: item.action },
    []
  );
  if ("open" in outcome) return { label: item.label, component: outcome.open };
  toast.success(`${item.label}: done.`);
  return null;
}

/**
 * Runs the plugins' menu actions, and holds the component one opened. Running
 * one again before it answers sends nothing, as on the entry list.
 */
export function usePluginMenuAction(): {
  run: (item: PluginUserMenuEntry) => Promise<void>;
  opened: OpenedMenuAction | null;
  close: () => void;
} {
  const [opened, setOpened] = useState<OpenedMenuAction | null>(null);
  const inFlight = useRef(new Set<string>());
  const run = useCallback(async (item: PluginUserMenuEntry) => {
    if (inFlight.current.has(item.id)) return;
    inFlight.current.add(item.id);
    try {
      const next = await runMenuAction(item);
      if (next) setOpened(next);
    } catch (error) {
      toast.error(apiErrorMessage(error, `${item.label} couldn't run.`));
    } finally {
      inFlight.current.delete(item.id);
    }
  }, []);
  const close = useCallback(() => setOpened(null), []);
  return { run, opened, close };
}

/** The dialog a menu action's component is drawn in. */
export function PluginMenuActionDialog({
  opened,
  close,
}: {
  opened: OpenedMenuAction | null;
  close: () => void;
}): JSX.Element {
  return (
    <Dialog
      open={opened !== null}
      onOpenChange={open => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <DialogTitle>{opened?.label}</DialogTitle>
        {opened ? (
          <PluginSlot
            path={opened.component}
            props={{ onClose: close }}
            fallback={
              <p className="text-sm text-muted-foreground">
                This action&apos;s component isn&apos;t available in this admin.
              </p>
            }
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
