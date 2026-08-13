"use client";

/**
 * The editor's command palette: one keyboard route to everything the host can do.
 *
 * The palette owns the SURFACE — the hotkey, the dialog, the search, the keyboard model — and
 * knows nothing about what the commands are. Panels, navigation and document edits are all the
 * host's vocabulary, and a palette that reached for them would need to import the shell's panel
 * list, the app's routes and the op store, which is three couplings for a component whose job is
 * to show a list and run what was chosen.
 *
 * So commands arrive as data. That also makes the interesting states reachable in a test without
 * mounting an editor: an empty registry, a command whose `when` is false, a command that throws.
 *
 * ## What is deliberately NOT here
 *
 * Undo, redo and block operations are absent because there is nothing to call. `applyOp` derives
 * an edit's inverse, and no history stack stores one — so a palette entry named "Undo" would have
 * to own the history itself, which is the wrong owner and would have to be taken back out. Block
 * operations additionally need a target node, and no selection model exists yet. Both are host
 * concerns the moment they exist, and this component needs no change to gain them: they arrive as
 * more commands.
 */
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  DialogDescription,
  DialogTitle,
  useShortcuts,
} from "@nextlyhq/ui";
import * as React from "react";
import { flushSync } from "react-dom";

/**
 * The keystroke that OPENS the palette, and the one nearly every editor uses for it.
 *
 * Opening only, never toggling. `CommandDialog` renders cmdk's `<Command>` internally and
 * forwards no props to it, so its vim bindings cannot be turned off from here — and those
 * bindings claim Ctrl+K for "move selection up" and call `preventDefault()`. The shortcut manager
 * skips an event another handler already prevented, so on Windows and Linux a toggle would open
 * the palette and then refuse to close it. Escape closes, which is what Radix already gives us
 * and what VS Code does. Better to not make the promise than to keep it on one platform.
 */
export const COMMAND_PALETTE_KEYS = "mod+k";

/**
 * One entry in the palette.
 *
 * `id` rather than the label as the identity, because labels are user-facing text that gets
 * reworded, and a React key that changes on a copy edit remounts the row and drops its state.
 */
export interface BuilderCommand {
  /** Stable across renames. Used as the React key and as the search value's suffix. */
  id: string;
  /** What the user reads. */
  label: string;
  /** Heading this command is listed under. Ungrouped commands are listed first, without one. */
  group?: string;
  /**
   * Extra words that should match this command.
   *
   * A palette is only as good as its synonyms: someone looking for "layers" should find "Outline"
   * without knowing what it was named.
   */
  keywords?: readonly string[];
  /** The shortcut to DISPLAY, if the host binds one elsewhere. Rendering it here binds nothing. */
  shortcut?: string;
  /** Checked whenever the list is built; a command that returns false is not offered. */
  when?: () => boolean;
  /** Runs when the command is chosen. The palette closes first. */
  run: () => void;
}

export interface CommandPaletteProps {
  /** Everything the palette can run. Order within a group is preserved. */
  commands: readonly BuilderCommand[];
  /**
   * Controls the dialog. Omit both to let the palette own its own open state, which is the usual
   * case; pass them when the host needs to open it from somewhere else as well.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Placeholder for the search field. */
  placeholder?: string;
  /** Shown when nothing matches what was typed. */
  emptyMessage?: string;
  /**
   * Whether the palette may be opened at all. Defaults to true.
   *
   * The dialog PORTALS to the document body, so it escapes any `hidden` or `inert` wrapper the
   * host has put its own subtree behind — a shell that has disabled itself below a minimum width
   * would still get an interactive palette floating over its narrow-screen notice. A host in that
   * state passes false, which both stops the hotkey and closes an already-open palette.
   */
  enabled?: boolean;
}

/**
 * Commands the host is currently offering, grouped for display.
 *
 * `when` is evaluated here rather than at registration, so a command that becomes available while
 * the palette is open appears on the next render instead of being fixed at mount.
 *
 * NAMED groups keep the order of first appearance rather than being sorted. A palette that
 * reorders itself between openings makes muscle memory impossible, and alphabetical order is not
 * the order anyone thinks in.
 *
 * Ungrouped commands are partitioned to the FRONT rather than taking their place in that order.
 * They render without a heading, so leaving them where they first appeared would let a host that
 * happened to list a grouped command first push a headingless run of items between two named
 * groups, where they read as belonging to the group above them.
 */
function groupAvailable(
  commands: readonly BuilderCommand[]
): { group?: string; commands: BuilderCommand[] }[] {
  const namedOrder: string[] = [];
  const byGroup = new Map<string | undefined, BuilderCommand[]>();

  for (const command of commands) {
    if (command.when && !command.when()) continue;
    let bucket = byGroup.get(command.group);
    if (!bucket) {
      bucket = [];
      byGroup.set(command.group, bucket);
      if (command.group !== undefined) namedOrder.push(command.group);
    }
    bucket.push(command);
  }

  const ungrouped = byGroup.get(undefined);
  return [
    ...(ungrouped ? [{ group: undefined, commands: ungrouped }] : []),
    ...namedOrder.map(group => ({
      group,
      commands: byGroup.get(group) ?? [],
    })),
  ];
}

/**
 * The palette.
 *
 * Must be rendered inside the shell's `ShortcutProvider` — `useShortcuts` throws otherwise, which
 * is the right failure: a palette that silently registered nothing would look mounted and never
 * open.
 */
export function CommandPalette({
  commands,
  open: controlledOpen,
  onOpenChange,
  placeholder = "Search commands…",
  emptyMessage = "No matching commands.",
  enabled = true,
}: CommandPaletteProps): React.JSX.Element {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  // One expression decides whether the palette is showing, so `enabled` cannot be honoured by the
  // hotkey and ignored by the dialog. A host that disables itself while the palette is already
  // open closes it by that alone, without needing to drive `open` as well.
  const open = enabled && (isControlled ? controlledOpen : uncontrolledOpen);

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );

  // Read through a ref so the binding's `run` never goes stale, without re-registering the layer
  // on every render — re-registering would move it to the top of its depth and change precedence
  // for a reason the caller never asked for.
  const latest = React.useRef({ open, setOpen });
  latest.current = { open, setOpen };

  useShortcuts(
    [
      {
        keys: COMMAND_PALETTE_KEYS,
        description: "Open the command palette",
        // `mod+k` carries a non-shift modifier, so the manager lets it fire while the user is
        // typing. That is what a palette needs: it has to be reachable from inside the very
        // fields it might act on.
        run: event => {
          // The browser binds `mod+k` to the address bar in some hosts, and the palette losing
          // the keystroke to the chrome is the one failure a user cannot work around.
          event.preventDefault();
          // Open, never toggle — see COMMAND_PALETTE_KEYS. Pressing it again while open is a
          // no-op rather than a close.
          latest.current.setOpen(true);
        },
      },
    ],
    {
      name: "command-palette",
      enabled,
      // While open the palette is a modal and owns the keyboard: without this the shell's own
      // bindings still fire underneath it, so F6 would move focus between panels the user cannot
      // see. The manager already exempts text insertion and Tab, so the search field and the
      // dialog's focus trap keep working.
      blocking: open,
    }
  );

  const groups = groupAvailable(commands);

  const choose = React.useCallback(
    (command: BuilderCommand) => {
      // Closed BEFORE running, and FLUSHED rather than queued. A plain `setOpen(false)` only
      // schedules the re-render, so `run()` would execute with the dialog still mounted and its
      // focus trap still holding — and a command that opens a dialog of its own or moves focus
      // then competes with a palette that is only just unmounting, leaving focus somewhere
      // neither component chose.
      flushSync(() => setOpen(false));
      command.run();
    },
    [setOpen]
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      {/*
       * Visually hidden, but the dialog's accessible name and description all the same:
       * `CommandDialog` renders neither, so without these a screen reader announces an unnamed
       * dialog and Radix logs a missing-description warning. The search field's placeholder is
       * not a substitute — it names the INPUT, not the dialog that wraps it.
       */}
      <DialogTitle className="sr-only">Command palette</DialogTitle>
      <DialogDescription className="sr-only">
        Search for a command and press Enter to run it.
      </DialogDescription>
      <CommandInput placeholder={placeholder} />
      <CommandList>
        <CommandEmpty>{emptyMessage}</CommandEmpty>
        {groups.map(({ group, commands: groupCommands }, index) => (
          <React.Fragment key={group ?? "__ungrouped"}>
            {index > 0 && <CommandSeparator />}
            <CommandGroup heading={group}>
              {groupCommands.map(command => (
                <CommandItem
                  key={command.id}
                  // The id is appended so two commands sharing a label stay separately
                  // selectable; cmdk keys its filtering on this value.
                  value={`${command.label} ${(command.keywords ?? []).join(" ")} ${command.id}`}
                  onSelect={() => choose(command)}
                >
                  {command.label}
                  {command.shortcut && (
                    <CommandShortcut>{command.shortcut}</CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </React.Fragment>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
