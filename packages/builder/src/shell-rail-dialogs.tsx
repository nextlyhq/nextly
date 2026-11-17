"use client";

/**
 * The shell's rail and the dialogs it opens: which panels it offers, the
 * help and Settings dialogs, and the host's request to open Settings.
 *
 * @module shell-rail-dialogs
 */
import * as React from "react";

import {
  EditorRail,
  PANEL_KEYS_LAYER,
  panelKeyShortcuts,
  type EditorRailProps,
} from "./editor-rail";
import { HelpDialog, type PanelKeysSetting } from "./help-dialog";
import type { BuilderShellProps } from "./shell-props";
import { isLeftPanel, topologyKey, type LeftPanel } from "./shell-state";

/**
 * The panel set about to be rendered, named the same way a persisted layout
 * is keyed. Derived from what is shown because that is what decides the set;
 * the persisted key is derived from the layout's own ids, and the two meet at
 * `topologyKey` rather than being two spellings of one arrangement.
 */
export function panelTopology(
  openPanel: LeftPanel | null,
  inspectorShown: boolean
): string {
  return topologyKey([
    ...(openPanel === null ? [] : ["panel"]),
    "canvas",
    ...(inspectorShown ? ["inspector"] : []),
  ]);
}

/**
 * Whether the host can fill a panel. One predicate, so the rail's items and
 * the panel the layout reserves cannot answer differently.
 *
 * A name this shell does not know is never available, whatever the host
 * offers: a request from untyped code can still name a panel that was
 * renamed or removed, Settings among them, and there is no chrome to draw it
 * with.
 */
export function panelAvailability(
  availablePanels: readonly LeftPanel[] | undefined
): (panel: LeftPanel) => boolean {
  return panel =>
    isLeftPanel(panel) &&
    (availablePanels === undefined || availablePanels.includes(panel));
}

/** Opens a rail dialog from the item pressed, which focus returns to. */
function opening(
  dialog: ReturnType<typeof useRailDialog>
): (button: HTMLElement) => void {
  return button => {
    dialog.opener.current = button;
    dialog.setOpen(true);
  };
}

/**
 * The rail's dialog items: Help always, and Settings where the host draws a
 * Settings dialog.
 */
function railDialogItems(
  help: ReturnType<typeof useRailDialog>,
  settings: ReturnType<typeof useRailDialog>,
  renderSettings: BuilderShellProps["renderSettings"]
): Pick<EditorRailProps, "onHelp" | "onSettings" | "settingsOpen"> {
  return {
    onHelp: opening(help),
    ...(renderSettings === undefined
      ? {}
      : { settingsOpen: settings.open, onSettings: opening(settings) }),
  };
}

/**
 * The rail, with the dialogs its bottom items open: Help, and Settings where
 * the host draws one. They own their open state here, beside the items that
 * open them.
 */
export function RailAndDialogs({
  active,
  renderSettings,
  panelKeys,
  ...rail
}: Omit<
  EditorRailProps,
  "onHelp" | "onSettings" | "settingsOpen" | "keysOn"
> & {
  active: boolean;
  renderSettings: BuilderShellProps["renderSettings"];
  panelKeys: Pick<PanelKeysSetting, "on" | "onChange">;
}): React.JSX.Element {
  // This editor's own panel-key layer, so Help can find its keys among a
  // second editor's on the same page.
  const keysLayer = `${PANEL_KEYS_LAYER} ${React.useId()}`;
  const help = useRailDialog(active);
  const settings = useRailDialog(active);
  useSettingsRequest(
    React.useContext(SettingsRequestContext),
    settings.setOpen,
    active
  );
  return (
    <>
      <EditorRail
        {...rail}
        keysOn={panelKeys.on}
        keysLayer={keysLayer}
        {...railDialogItems(help, settings, renderSettings)}
      />
      <HelpDialog
        open={help.open}
        onOpenChange={help.setOpen}
        returnFocus={() => help.opener.current}
        panelKeys={{
          ...panelKeys,
          shortcuts: panelKeyShortcuts(rail.isAvailable, keysLayer),
          layer: keysLayer,
          family: PANEL_KEYS_LAYER,
        }}
      />
      <HostSettings render={renderSettings} dialog={settings} />
    </>
  );
}

/** The host's Settings dialog, handed whether it is open, when it draws one. */
function HostSettings({
  render,
  dialog,
}: {
  render: BuilderShellProps["renderSettings"];
  dialog: ReturnType<typeof useRailDialog>;
}): React.ReactNode {
  if (render === undefined) return null;
  return render({
    open: dialog.open,
    onOpenChange: dialog.setOpen,
    returnFocus: () => dialog.opener.current,
  });
}

/**
 * A rail dialog's open state (Help's, Settings'), and the control focus
 * returns to when it closes.
 *
 * It closes when the editor gives way to the narrow-window notice. The
 * regions stay mounted there, hidden and inert, and a modal left open would
 * keep its focus trap and its hold on the keyboard over a notice whose Exit
 * button it would then keep out of reach. Closed rather than hidden, so
 * widening the window again does not bring back a dialog nobody reopened.
 */
/**
 * The host's open-Settings request, handed from the shell's props to the rail
 * that owns the dialog. A context rather than a prop through the regions in
 * between, which only pass it along.
 */
export const SettingsRequestContext: React.Context<
  BuilderShellProps["openSettingsRequest"]
> = React.createContext<BuilderShellProps["openSettingsRequest"]>(undefined);

/**
 * Opens Settings once for each new `count` a host sends. A ref, not state,
 * holds the count last applied, so the request is applied at most once and a
 * re-render does not reopen a dialog the author closed.
 */
function useSettingsRequest(
  request: BuilderShellProps["openSettingsRequest"],
  setOpen: (open: boolean) => void,
  active: boolean
): void {
  const handled = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    // Not while the shell has given way to its narrow-window notice: a dialog
    // there would trap focus over the notice's way out. The request waits,
    // unconsumed, and opens Settings once the shell is in use again.
    if (!active) return;
    if (request === undefined || handled.current === request.count) return;
    handled.current = request.count;
    setOpen(true);
  }, [request, setOpen, active]);
}

function useRailDialog(active: boolean): {
  open: boolean;
  setOpen: (open: boolean) => void;
  opener: React.RefObject<HTMLElement | null>;
} {
  const [open, setOpen] = React.useState(false);
  const opener = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  return { open, setOpen, opener };
}
