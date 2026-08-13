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
  commandDefaultFilter,
  ShortcutScope,
  useShortcuts,
} from "@nextlyhq/ui";
import * as React from "react";
import { flushSync } from "react-dom";

import { useShellIsActive } from "./builder-shell";

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
  /**
   * Everything the palette can run.
   *
   * Order within a group is preserved WHILE THE SEARCH IS EMPTY.
   *
   * Once the user types, the groups are dropped and every match is offered as one list, ordered
   * by cmdk across all of them. Deliberately not promised: that an exact match outranks a partial
   * one. cmdk keys SELECTION on an item's value, so the value here has to be the `id` alone —
   * anything richer is a concatenation of free-form fields and two commands can collide, which
   * makes the wrong one run. The label and synonyms are still what the search matches on, through
   * cmdk's separate keywords input, but scoring over them is cmdk's and is not specified here.
   */
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
   * Whether the palette may be opened at all.
   *
   * Defaults to whether the surrounding shell is interactive, and to `true` outside one. The
   * dialog PORTALS to the document body, so it escapes the `hidden`/`inert` wrapper the shell
   * puts its slots behind below its minimum width — without this it would float, fully
   * interactive, over the narrow-screen notice.
   *
   * NARROWS the shell's answer rather than replacing it: passing `false` disables the palette,
   * and passing `true` does NOT re-enable one inside a shell that has taken itself out of
   * service. A host condition of its own — `enabled={!readOnly}` — is therefore safe to pass
   * without also re-deriving the shell's minimum width, which would be a second implementation of
   * a question the shell already answers.
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
export function CommandPalette(props: CommandPaletteProps): React.JSX.Element {
  // A scope of its own, so the palette's layer sits one level DEEPER than the host that renders
  // it. Layers at equal depth are ordered by registration, newest first, which would leave the
  // modal's hold over the keyboard depending on whether the host happened to register its own
  // shortcuts before or after the palette mounted.
  return (
    <ShortcutScope>
      <PaletteSurface {...props} />
    </ShortcutScope>
  );
}

function PaletteSurface({
  commands,
  open: controlledOpen,
  onOpenChange,
  placeholder = "Search commands…",
  emptyMessage = "No matching commands.",
  enabled: enabledProp,
}: CommandPaletteProps): React.JSX.Element {
  // The shell's own answer, so the width that hides its slots is the width that disables the
  // palette. `true` outside a shell, which is what a standalone caller wants.
  const shellIsActive = useShellIsActive();
  // The prop NARROWS the shell's answer rather than replacing it. A host passing a condition of
  // its own — `enabled={!readOnly}` — would otherwise re-enable the palette whenever that
  // condition held, including on a viewport where the shell has hidden everything else, which is
  // the case this prop exists to cover.
  const enabled = (enabledProp ?? true) && shellIsActive;
  const [search, setSearch] = React.useState("");
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  // One expression decides whether the palette is showing, so `enabled` cannot be honoured by the
  // hotkey and ignored by the dialog. A host that disables itself while the palette is already
  // open closes it by that alone, without needing to drive `open` as well.
  const open = enabled && (isControlled ? controlledOpen : uncontrolledOpen);

  // Masking the state is not enough: `open` above hides it, but the stored `true` survives, so
  // re-enabling — a shell widening back past its minimum — would reopen the palette without
  // anyone having pressed the hotkey. Cleared rather than masked, so closing is permanent.
  //
  // A CONTROLLED host owns that state instead, and clearing our copy would leave its `open` still
  // true and reopen the palette the moment the shell widens. It is told, so its state clears too.
  React.useEffect(() => {
    if (enabled) return;
    setUncontrolledOpen(false);
    if (isControlled && controlledOpen) onOpenChange?.(false);
  }, [enabled, isControlled, controlledOpen, onOpenChange]);

  // What had focus when the palette opened, so closing can hand it back. Radix restores focus to
  // the dialog's TRIGGER, and a palette opened by a keystroke has none — so without this, closing
  // drops focus onto `<body>` and a keyboard user starts again from the top of the document.
  const openedFrom = React.useRef<Element | null>(null);

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );

  // Recorded on the open TRANSITION, in a layout effect so it happens before Radix moves focus
  // into the dialog. The transition rather than `setOpen`, because a controlling host opens the
  // palette by flipping `open` and never calls it.
  const wasOpen = React.useRef(false);
  React.useLayoutEffect(() => {
    const opening = !wasOpen.current && open;
    wasOpen.current = open;
    if (!opening) return;
    // Any focusable ELEMENT. An `<svg tabindex="0">` becomes `activeElement` and is not an
    // `HTMLElement`, so narrowing here discards a legitimate origin.
    openedFrom.current = document.activeElement;
  }, [open]);

  // Radix fires this when it is actually returning focus, which is AFTER the exit animation. A
  // timer started at close time cannot know that duration — measured against this dialog's
  // 200ms `animate-out`, the search input is still connected when a zero-delay callback runs, so
  // focus looks settled, nothing is restored, and it lands on `<body>` once the animation ends.
  //
  // Radix's own default is to focus the trigger; this dialog is opened by a keystroke and has
  // none, so the default resolves to nothing and the event is prevented in favour of the origin.
  const handleCloseAutoFocus = React.useCallback((event: Event) => {
    const target = openedFrom.current;
    openedFrom.current = null;
    if (!target?.isConnected) return;
    // `focus` is on the `HTMLOrSVGElement` mixin rather than on `Element`.
    const refocus = (target as Partial<HTMLOrSVGElement>).focus;
    if (typeof refocus !== "function") return;
    // Only once nothing else has claimed focus — a command that moved it deliberately wins.
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    event.preventDefault();
    refocus.call(target);
  }, []);

  // Cleared when the palette shuts, so a stale search never greets the next opening.
  React.useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

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

  // While a search is active every match goes into ONE headingless list. cmdk ranks items inside
  // a group and leaves the groups in their own order, so a better match in a later group would
  // otherwise sit below a weaker one. Headings are what the groups are for, and they say nothing
  // useful about a set of search results.
  // ONE normalised query decides the mode AND is what the matcher scores against. What it must
  // NOT do is reach the input: a controlled value that trims rewrites the user's text as they
  // type, so pressing Space after `open` gives back `open`, the next key produces `opens`, and
  // `open settings` is unreachable. The raw string stays editable; the normalised one is derived.
  const query = search.trim();
  const searching = query.length > 0;
  // Grouped FIRST, then flattened. Filtering `commands` again along a second path would be a
  // second answer to "is this command available", and the two would agree only until someone
  // changed one — silently offering a different set while the user is searching, which is the
  // half nobody looks at.
  const available = groupAvailable(commands);
  const groups = searching
    ? [{ group: undefined, commands: available.flatMap(g => g.commands) }]
    : available;

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
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      // Names the search input. cmdk renders a hidden label for the command root and points the
      // input's `aria-labelledby` at it, so leaving this unset produces an EMPTY label — an
      // explicit reference to nothing, which stops the placeholder naming the field and leaves
      // screen-reader users on an unlabelled search control.
      commandProps={{
        label: "Command palette",
        // Scores the LABEL and synonyms only. cmdk's default scores an item's value too, and the
        // value here is an encoded id — opaque fragments would surface unrelated commands, and
        // every encoded id begins and ends with a quote, so a query containing one matched
        // everything. The default scorer still does the ranking; it is just given the words a
        // user is actually typing towards.
        // Scored against the NORMALISED query rather than cmdk's raw one, so the mode decision
        // and the matching agree: a whitespace-only input is no search to either, and leading or
        // trailing space does not quietly change anyone's ranking.
        filter: (_value, _search, keywords) =>
          commandDefaultFilter(keywords?.join(" ") ?? "", query),
      }}
      contentProps={{ onCloseAutoFocus: handleCloseAutoFocus }}
    >
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
      <CommandInput
        placeholder={placeholder}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>{emptyMessage}</CommandEmpty>
        {groups.map(({ group, commands: groupCommands }, index) => (
          <React.Fragment
            key={group === undefined ? "ungrouped" : `group:${group}`}
          >
            {index > 0 && <CommandSeparator />}
            <CommandGroup heading={group}>
              {groupCommands.map(command => (
                <CommandItem
                  key={command.id}
                  // The id ALONE, because cmdk keys selection on this value and a concatenation
                  // of free-form fields is not injective: `keywords: ["page"], id: "settings x"`
                  // and `keywords: ["page", "settings"], id: "x"` produce the same string, and
                  // cmdk then highlights both rows and activates the first whichever is chosen.
                  // What the search should MATCH goes to `keywords`, which cmdk reads separately.
                  //
                  // ENCODED because cmdk trims the value before using it as the identity, so
                  // `"save"` and `"save "` — distinct ids by the type's contract — would collide
                  // again through normalisation rather than through concatenation. The quotes
                  // `JSON.stringify` adds sit at both ends, so there is no edge whitespace for the
                  // trim to reach.
                  //
                  // `JSON.stringify` rather than `encodeURIComponent`, which is not TOTAL over the
                  // strings `id: string` admits: a lone UTF-16 surrogate — `"\ud800"`, which
                  // survives a JSON round trip — raises `URIError` and takes the whole palette
                  // down during render. Well-formed stringify escapes it instead.
                  value={JSON.stringify(command.id)}
                  keywords={[command.label, ...(command.keywords ?? [])]}
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
