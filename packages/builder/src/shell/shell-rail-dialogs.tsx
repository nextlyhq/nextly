"use client";

/**
 * The shell's rail and the dialogs it opens: which panels it offers, the
 * help and Settings dialogs, and the host's request to open Settings.
 *
 * @module shell-rail-dialogs
 */
import * as React from "react";

import { useLatestCallback } from "../latest-callback";
import { isLeftPanel, topologyKey, type LeftPanel } from "../shell-state";

import {
  EditorRail,
  PANEL_KEYS_LAYER,
  panelKeyShortcuts,
  type EditorRailProps,
} from "./editor-rail";
import { HelpDialog, type PanelKeysSetting } from "./help-dialog";
import type { BuilderShellProps } from "./shell-props";

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

/**
 * Opens a rail dialog from the item pressed, which focus returns to. One
 * function for the dialog's life, so the memoised rail is handed the same.
 */
function useOpening(
  dialog: ReturnType<typeof useRailDialog>
): (button: HTMLElement) => void {
  const { opener, setOpen } = dialog;
  return React.useCallback(
    (button: HTMLElement) => {
      opener.current = button;
      setOpen(true);
    },
    [opener, setOpen]
  );
}

/** What the shell hands the rail and its dialogs. */
type RailAndDialogsProps = Pick<
  EditorRailProps,
  "openPanel" | "isAvailable" | "onSelect" | "railRef"
> & {
  active: boolean;
  renderSettings: BuilderShellProps["renderSettings"];
  /** Whether a panel key pressed now is this rail's to answer. */
  claimsKeys: () => boolean;
  panelKeys: Pick<PanelKeysSetting, "on" | "onChange">;
};

/**
 * The rail, with the dialogs its bottom items open: Help, and Settings where
 * the host draws one. They own their open state here, beside the items that
 * open them.
 *
 * Drawn again only when something they show changes. The shell renders again
 * for every change of what it holds, a selection among them, and hands this a
 * new rail ref, a new panel-key check and a new setting each time; those
 * functions are read when called (the rail's keys are registered as it draws,
 * so a key pressed after a render it skipped still acts on the newest
 * preferences), and the setting is handed on as its value, so the memoised
 * rail is handed the same props while only the selection moves. Nothing here
 * shows the selected block. `isAvailable` is read while drawing, so the shell
 * keeps it as one function for as long as the host's panels are the same.
 */
export function RailAndDialogs(props: RailAndDialogsProps): React.JSX.Element {
  const railRef = useLatestCallback(props.railRef);
  const onSelect = useLatestCallback(props.onSelect);
  const claimsKeys = useLatestCallback(props.claimsKeys);
  const onKeysChange = useLatestCallback(props.panelKeys.onChange);
  return (
    <KeptRailAndDialogs
      active={props.active}
      renderSettings={props.renderSettings}
      openPanel={props.openPanel}
      isAvailable={props.isAvailable}
      onSelect={onSelect}
      railRef={railRef}
      claimsKeys={claimsKeys}
      keysOn={props.panelKeys.on}
      onKeysChange={onKeysChange}
    />
  );
}

/** Help, memoised: drawn again only as it opens or closes or its keys change. */
const KeptHelpDialog = React.memo(HelpDialog);

/**
 * The rail, memoised: drawn again only for what it shows (the panel open,
 * Settings pressed, the keys on or off), not when Settings or Help beside it
 * is drawn again.
 */
const KeptEditorRail = React.memo(EditorRail);

/**
 * The rail and its dialogs, memoised, so they draw again only for a prop that
 * changed: a panel opened, the panel keys turned off, a new Settings.
 */
const KeptRailAndDialogs = React.memo(function RailAndDialogsKept({
  active,
  renderSettings,
  keysOn,
  onKeysChange,
  ...rail
}: Omit<RailAndDialogsProps, "panelKeys"> & {
  keysOn: boolean;
  onKeysChange: (on: boolean) => void;
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
  const openHelp = useOpening(help);
  const openSettings = useOpening(settings);
  const { opener: helpOpener } = help;
  const returnHelpFocus = React.useCallback(
    () => helpOpener.current,
    [helpOpener]
  );
  // A new setting only when what Help shows of the keys changes, so the rail
  // drawing again (a panel opened, Settings pressed) leaves Help alone.
  const { isAvailable } = rail;
  const panelKeys = React.useMemo(
    () => ({
      on: keysOn,
      onChange: onKeysChange,
      shortcuts: panelKeyShortcuts(isAvailable, keysLayer),
      layer: keysLayer,
      family: PANEL_KEYS_LAYER,
    }),
    [keysOn, onKeysChange, isAvailable, keysLayer]
  );
  return (
    <>
      <KeptEditorRail
        {...rail}
        keysOn={keysOn}
        keysLayer={keysLayer}
        // Help always, and Settings where the host draws a Settings dialog.
        onHelp={openHelp}
        {...(renderSettings === undefined
          ? {}
          : { settingsOpen: settings.open, onSettings: openSettings })}
      />
      <KeptHelpDialog
        open={help.open}
        onOpenChange={help.setOpen}
        returnFocus={returnHelpFocus}
        panelKeys={panelKeys}
      />
      <HostSettings
        render={renderSettings}
        open={settings.open}
        onOpenChange={settings.setOpen}
        opener={settings.opener}
      />
    </>
  );
});

/**
 * The host's Settings dialog, handed whether it is open, when it draws one.
 * Memoised, so the host's `renderSettings` is called again only when it is a
 * new function or the dialog opens or closes: a host that keeps it as one
 * function while what Settings shows is unchanged has none of it drawn again.
 */
const HostSettings = React.memo(function HostSettings({
  render,
  open,
  onOpenChange,
  opener,
}: {
  render: BuilderShellProps["renderSettings"];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opener: React.RefObject<HTMLElement | null>;
}): React.ReactNode {
  if (render === undefined) return null;
  return render({
    open,
    onOpenChange,
    returnFocus: () => opener.current,
  });
});

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
