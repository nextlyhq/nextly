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
  useCommandHighlight,
  useShortcuts,
} from "@nextlyhq/ui";
import * as React from "react";
import { flushSync } from "react-dom";

import { deepActiveElement } from "./dom-kind";
import { useModalKeyboardHold } from "./modal-keyboard-hold";
import { useShellIsActive } from "./shell-active";

/**
 * The keystroke that OPENS the palette, and the one nearly every editor uses for it.
 *
 * Opening only, never toggling. `CommandDialog` renders cmdk's `<Command>` internally and
 * forwards no props to it, so its vim bindings cannot be turned off from here — and those
 * bindings claim Ctrl+K for "move selection up" and call `preventDefault()`. The shortcut manager
 * skips an event another handler already prevented, so on Windows and Linux a toggle would open
 * the palette and then refuse to close it. Escape closes, which is what Radix already gives us
 * and what VS Code does. Better to not make the promise than to keep it on one platform.
 *
 * @experimental
 */
export const COMMAND_PALETTE_KEYS = "mod+k";

/**
 * One entry in the palette.
 *
 * `id` rather than the label as the identity, because labels are user-facing text that gets
 * reworded, and a React key that changes on a copy edit remounts the row and drops its state.
 *
 * @experimental
 */
export interface BuilderCommand {
  /**
   * Stable across renames, and UNIQUE across the assembled list.
   *
   * Uniqueness is required rather than merely expected: it is the React key and cmdk's selection
   * identity, and two rows sharing it are both marked selected, with Enter running the first
   * whichever the user chose. A host that concatenates registries is where this happens.
   */
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
  /** A small glyph before the label. Decorative: the label alone names the row. */
  icon?: React.ReactNode;
  /**
   * Said after the label, more quietly: where a block will go, what a row is, the shortcut's
   * neighbour. Not searched — what the search matches is the label and `keywords`.
   */
  detail?: React.ReactNode;
  /**
   * The footer's word for choosing this row while it is highlighted: "Add", "Select", "Open".
   * "Run" when absent, which is what a command does.
   */
  verb?: string;
  /** Runs when the command is chosen. The palette closes first. */
  run: () => void;
}

/**
 * How one named group behaves while the author searches.
 *
 * @experimental
 */
export interface CommandGroupOptions {
  /** The group's heading, as the commands name it in `group`. */
  name: string;
  /** At most this many matches, best first. Every match when absent. */
  limit?: number;
  /**
   * The host has matched these already — a search made on the server — so each is shown as
   * given, in the host's order. Scoring them again here could drop a row the server matched on
   * something the label does not show.
   */
  matched?: boolean;
  /**
   * Said in the group's place while its results are on their way, or could not be had
   * ("Searching pages…"). Shown even when the group has no rows yet, so the author can tell a
   * search still running from one that found nothing.
   */
  status?: string;
}

/**
 * What the host gives the palette.
 *
 * @experimental
 */
export interface CommandPaletteProps {
  /**
   * Everything the palette can run.
   *
   * Order within a group is preserved WHILE THE SEARCH IS EMPTY.
   *
   * Once the user types, the groups STAY, each under its heading and in the same order, and the
   * matches inside each are ranked best first by cmdk's scorer over the label and synonyms. The
   * groups are kinds of thing (blocks to add, blocks on the page, pages, commands), and an author
   * reads a result by its kind before its rank. cmdk keys SELECTION on an item's value, so the
   * value here is the `id` alone — anything richer is a concatenation of free-form fields and two
   * commands can collide, which makes the wrong one run.
   */
  commands: readonly BuilderCommand[];
  /**
   * Controls the dialog. Omit both to let the palette own its own open state, which is the usual
   * case; pass them when the host needs to open it from somewhere else as well.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Named groups' order and their behaviour while searching. A group listed here comes in this
   * order; one that is not follows, in the order its commands first appear.
   */
  groups?: readonly CommandGroupOptions[];
  /**
   * Told the search as the author types it, trimmed, for a host that searches elsewhere too (the
   * site's pages, on the server). Its answers come back as commands in a `matched` group.
   */
  onSearchChange?: (query: string) => void;
  /** Placeholder for the search field. */
  placeholder?: string;
  /** Shown when nothing matches what was typed. Given the search, so it can quote it. */
  emptyMessage?: React.ReactNode | ((query: string) => React.ReactNode);
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
  commands: readonly BuilderCommand[],
  declared: readonly CommandGroupOptions[] = []
): { group?: string; commands: BuilderCommand[] }[] {
  // Declared groups first, in their order, so a group the host has not filled yet (a search still
  // on its way) already holds its place.
  const namedOrder: string[] = declared.map(options => options.name);
  const byGroup = new Map<string | undefined, BuilderCommand[]>(
    namedOrder.map(name => [name, []])
  );

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
 *
 * @experimental
 */
export function CommandPalette(props: CommandPaletteProps): React.JSX.Element {
  return <PaletteSurface {...props} />;
}

/**
 * The palette's hold on the keyboard while it is open.
 *
 * Through the shared hold rather than its own `useShortcuts`, so a dialog the
 * editor raises and this palette cannot end up disagreeing about depth — which
 * is the part of this that is easy to get wrong and impossible to notice.
 *
 * Separate from the OPENER, and that is the point. Elevating the opener too
 * would put `mod+k` above a blocking layer the host already has up — another
 * modal's — and the palette would open over it, since the manager resolves the
 * deeper exact binding first. The opener stays ambient so an existing modal can
 * refuse it; only the hold is elevated, and only while open.
 */
function ModalKeyboardHold({ active }: { active: boolean }): null {
  useModalKeyboardHold("command-palette-modal", active);
  return null;
}

/** One group as the list draws it: its rows, and what it says in their place. */
interface ShownGroup {
  group?: string;
  commands: BuilderCommand[];
  status?: string;
}

/**
 * What a search shows of each group: its matches, best first, up to its limit.
 *
 * Ranked by the same scorer the palette has always used, over the label and synonyms, so a
 * group's order is cmdk's answer rather than a second one. A group the host matched already
 * keeps every row in the host's order. A group with neither rows nor a status is left out, so
 * no heading stands over nothing.
 */
function searchGroups(
  available: readonly { group?: string; commands: BuilderCommand[] }[],
  query: string,
  declared: readonly CommandGroupOptions[]
): ShownGroup[] {
  return available.flatMap(({ group, commands }) => {
    const options = declared.find(entry => entry.name === group);
    const ranked =
      options?.matched === true
        ? commands
        : commands
            .map((command, index) => ({
              command,
              index,
              score: commandDefaultFilter(searchText(command), query),
            }))
            .filter(entry => entry.score > 0)
            // Ties keep the host's order, so equal matches do not shuffle between keystrokes.
            .sort((a, b) => b.score - a.score || a.index - b.index)
            .map(entry => entry.command);
    const shown =
      options?.limit === undefined ? ranked : ranked.slice(0, options.limit);
    if (shown.length === 0 && options?.status === undefined) return [];
    return [{ group, commands: shown, status: options?.status }];
  });
}

/** The words a command is found by: its label and its synonyms. */
function searchText(command: BuilderCommand): string {
  return [command.label, ...(command.keywords ?? [])].join(" ");
}

/**
 * The label, with the typed text in bold where it begins a word.
 *
 * Only there. The scorer also finds letters scattered through a word, and bolding "he" inside
 * "the" marks a match nobody was looking for; such a row is still offered and ranked, just shown
 * plain. A label whose lower-case form changes length is shown plain too, since the positions
 * found in one would not be positions in the other.
 */
function emphasised(label: string, query: string): React.ReactNode {
  const lower = label.toLowerCase();
  const wanted = query.toLowerCase();
  if (wanted === "" || lower.length !== label.length) return label;
  let at = lower.indexOf(wanted);
  // Bounded by the label's length: each step moves past the last place found.
  while (at > 0 && /[\p{L}\p{N}]/u.test(label.charAt(at - 1))) {
    at = lower.indexOf(wanted, at + 1);
  }
  if (at === -1) return label;
  const end = at + wanted.length;
  return (
    <>
      {label.slice(0, at)}
      <mark className="bg-transparent font-semibold text-inherit">
        {label.slice(at, end)}
      </mark>
      {label.slice(end)}
    </>
  );
}

/** A key, as the footer names it. */
function Key({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="rounded border border-border bg-muted px-1 font-mono text-[11px] text-muted-foreground">
      {children}
    </kbd>
  );
}

/**
 * The keys that work here, with the highlighted row's own verb for Enter.
 *
 * Reads the highlight from the palette rather than keeping a copy: the palette moves it for
 * reasons this never sees (a pointer, a filter), and a copy would name the wrong row.
 */
function PaletteFooter({
  verbs,
}: {
  verbs: ReadonlyMap<string, string>;
}): React.JSX.Element {
  const highlighted = useCommandHighlight();
  const verb = verbs.get(highlighted);
  return (
    <div className="flex items-center gap-4 border-t border-border px-3 py-2 text-xs text-muted-foreground">
      {verb === undefined ? null : (
        <>
          <span>
            <Key>↑</Key> <Key>↓</Key> Move
          </span>
          <span>
            <Key>↵</Key> {verb}
          </span>
        </>
      )}
      <span>
        <Key>Esc</Key> Close
      </span>
    </div>
  );
}

/**
 * One group's heading and rows, or what it says in their place.
 *
 * A status shows beside the rows rather than instead of them only when there are none: a search
 * still running says so, and one that failed says that, without hiding what is already there.
 */
function PaletteGroup({
  shown,
  query,
  choose,
}: {
  shown: ShownGroup;
  query: string;
  choose: (command: BuilderCommand) => void;
}): React.JSX.Element {
  return (
    <CommandGroup heading={shown.group}>
      {shown.status === undefined || shown.commands.length > 0 ? null : (
        <div role="status" className="px-3 py-2 text-sm text-muted-foreground">
          {shown.status}
        </div>
      )}
      {shown.commands.map(command => (
        <CommandItem
          // The searchable metadata is part of the key, so renaming a command REMOUNTS
          // its row. cmdk stores an item's keywords when its value is registered and
          // refreshes them only when that value changes — and the value is the id,
          // stable by contract. Without this the row shows its new label while cmdk
          // keeps filtering on the old one, so searching for what is on screen hides it.
          //
          // A JSON TUPLE rather than the fields joined by a delimiter, for the reason
          // the cmdk value has the same shape: joining free-form strings is not
          // injective. `keywords: ["open\u0000settings"]` and `["open", "settings"]`
          // produce the same delimited string, so that rename would not remount and
          // cmdk would keep the old metadata — the defect this key exists to prevent.
          key={JSON.stringify([
            command.id,
            command.label,
            command.keywords ?? [],
          ])}
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
          {command.icon === undefined ? null : (
            <span
              aria-hidden="true"
              className="flex shrink-0 items-center text-muted-foreground"
            >
              {command.icon}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">
            {emphasised(command.label, query)}
          </span>
          {command.detail === undefined ? null : (
            <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
              {command.detail}
            </span>
          )}
          {command.shortcut && (
            <CommandShortcut>{command.shortcut}</CommandShortcut>
          )}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

/**
 * What the list shows for this search, and the footer's verb for each row.
 *
 * Every available command, grouped, and refused when two share an id. While
 * searching, each group's matches (see {@link searchGroups}); otherwise every
 * group that has a row.
 */
function shownGroups(
  commands: readonly BuilderCommand[],
  declared: readonly CommandGroupOptions[],
  query: string
): { groups: ShownGroup[]; verbs: ReadonlyMap<string, string> } {
  const searching = query.length > 0;
  // Grouped FIRST, then flattened. Filtering `commands` again along a second path would be a
  // second answer to "is this command available", and the two would agree only until someone
  // changed one — silently offering a different set while the user is searching, which is the
  // half nobody looks at.
  const available = groupAvailable(commands, declared);

  // Refused rather than rendered. A duplicate id makes cmdk run the WRONG command, silently and
  // only through the keyboard — the failure a caller is least able to see and least likely to
  // attribute to their registry. Throwing is the same choice `useShortcuts` makes outside a
  // provider, and for the same reason: a palette that looks mounted and misfires is worse than
  // one that refuses to mount.
  //
  // Over the AVAILABLE list, so a `when` that hides one of a colliding pair is a resolution
  // rather than a latent fault.
  const seen = new Set<string>();
  for (const { commands: groupCommands } of available) {
    for (const command of groupCommands) {
      if (seen.has(command.id)) {
        throw new Error(
          `CommandPalette received two available commands with the id "${command.id}". ` +
            "Ids are the selection identity, so a duplicate runs the wrong command."
        );
      }
      seen.add(command.id);
    }
  }
  const groups: ShownGroup[] = searching
    ? searchGroups(available, query, declared)
    : available.filter(group => group.commands.length > 0);
  // The footer's verb for each row, by the value cmdk highlights it under.
  const verbs = new Map(
    groups.flatMap(group =>
      group.commands.map(
        command => [JSON.stringify(command.id), command.verb ?? "Run"] as const
      )
    )
  );

  return { groups, verbs };
}

/**
 * The search text, and a setter that tells a host the trimmed search in the
 * SAME update as the keystroke.
 *
 * Not after the render that shows it: a host's own results (a group marked
 * `matched`, which this palette shows unfiltered) are answers to the search
 * they came from, and told only afterwards the host would leave them on screen
 * under the new search for a render, where Enter could choose one. Told here,
 * the host's change and the new text render together. Read through a ref, so a
 * host passing a fresh function each render changes nothing.
 */
function useSearchText(
  onSearchChange: ((query: string) => void) | undefined
): [string, (next: string) => void] {
  const [search, setSearch] = React.useState("");
  const listener = React.useRef(onSearchChange);
  listener.current = onSearchChange;
  // What the host was last told, so a keystroke that changes only the edge
  // spaces tells it nothing.
  const told = React.useRef("");
  const change = React.useCallback((next: string) => {
    setSearch(next);
    const query = next.trim();
    if (query === told.current) return;
    told.current = query;
    listener.current?.(query);
  }, []);
  return [search, change];
}

/** The groups, or the empty message, and the keys that work on them. */
function PaletteList({
  groups,
  verbs,
  query,
  emptyMessage,
  choose,
}: {
  groups: readonly ShownGroup[];
  verbs: ReadonlyMap<string, string>;
  query: string;
  emptyMessage: CommandPaletteProps["emptyMessage"];
  choose: (command: BuilderCommand) => void;
}): React.JSX.Element {
  const nothing = groups.length === 0;
  return (
    <>
      <CommandList>
        {nothing ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {typeof emptyMessage === "function"
              ? emptyMessage(query)
              : emptyMessage}
          </div>
        ) : null}
        {groups.map((shown, index) => (
          <React.Fragment
            key={
              shown.group === undefined ? "ungrouped" : `group:${shown.group}`
            }
          >
            {index > 0 && <CommandSeparator alwaysRender />}
            <PaletteGroup shown={shown} query={query} choose={choose} />
          </React.Fragment>
        ))}
      </CommandList>
      {nothing ? null : <PaletteFooter verbs={verbs} />}
    </>
  );
}

function PaletteSurface({
  commands,
  open: controlledOpen,
  onOpenChange,
  groups: declaredGroups = [],
  onSearchChange,
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
  const [search, setSearch] = useSearchText(onSearchChange);
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
    //
    // Only when no origin is outstanding. Reopening before the 200ms exit animation finishes
    // leaves focus inside the dialog that is still unmounting, so capturing then would record the
    // palette's OWN search input — and by the final close that element is gone, so there is
    // nothing to restore and focus lands on `<body>`. A completed close clears this, so an
    // ordinary second opening still records a fresh origin.
    //
    // Read through any focused frame, so an origin inside the canvas frame is the control itself
    // rather than the iframe, whose inner focus the browser restores as it chooses.
    if (openedFrom.current === null)
      openedFrom.current = deepActiveElement(document);
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
    // This document's own reading: focus a command put inside a frame shows here as the iframe,
    // which is not `<body>`, so the command still wins.
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    event.preventDefault();
    refocus.call(target);
  }, []);

  // Cleared when the palette shuts, so a stale search never greets the next opening.
  React.useEffect(() => {
    if (!open) setSearch("");
  }, [open, setSearch]);

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
      // NOT blocking, and at the HOST's depth. The hold while open belongs to
      // `ModalKeyboardHold` below; an opener that blocked, or that sat deeper than the host,
      // would answer `mod+k` over a modal the host already has up.
    }
  );

  // ONE normalised query decides the mode AND is what the matcher scores against. What it must
  // NOT do is reach the input: a controlled value that trims rewrites the user's text as they
  // type, so pressing Space after `open` gives back `open`, the next key produces `opens`, and
  // `open settings` is unreachable. The raw string stays editable; the normalised one is derived.
  const query = search.trim();
  const { groups, verbs } = shownGroups(commands, declaredGroups, query);

  const choose = React.useCallback(
    (command: BuilderCommand) => {
      // Closed BEFORE running, and FLUSHED rather than queued.
      //
      // What the flush buys is the FOCUS TRAP, not the unmount. Radix keeps the content mounted
      // for the exit animation either way, so `run()` always executes with the dialog still in
      // the DOM — but the modal content is trapped only while the dialog is open
      // (`trapFocus: context.open`), and its close handler always prevents the scope's own
      // restore. So a synchronous close leaves a mounted, focus-inert dialog, and anything the
      // command focuses keeps focus.
      //
      // Queue the close instead and React batches it: `run()` then executes while the trap is
      // still armed, and a command that focuses an element outside the palette has focus pulled
      // straight back inside it.
      //
      // Deferring `run()` until the dialog is truly gone would also work and is worse: Radix
      // dispatches its close-auto-focus from a `setTimeout` after the animation, so every command
      // would wait out the 200ms `animate-out` before doing anything.
      flushSync(() => setOpen(false));
      command.run();
    },
    [setOpen]
  );

  return (
    <>
      <ShortcutScope>
        <ModalKeyboardHold active={open} />
      </ShortcutScope>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        // Names the search input. cmdk renders a hidden label for the command root and points the
        // input's `aria-labelledby` at it, so leaving this unset produces an EMPTY label — an
        // explicit reference to nothing, which stops the placeholder naming the field and leaves
        // screen-reader users on an unlabelled search control.
        commandProps={{
          label: "Command palette",
          // The list is filtered and ranked HERE (`searchGroups`), not by cmdk: a group's limit
          // and a host's own matches are things cmdk cannot express, and two filters over one
          // list would disagree about what is offered. The scorer is still cmdk's, given the
          // label and synonyms only (an item's value is an encoded id, and opaque fragments of it
          // would surface unrelated commands) and the NORMALISED query, so a whitespace-only
          // input is no search to anyone.
          shouldFilter: false,
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
        <PaletteList
          groups={groups}
          verbs={verbs}
          query={query}
          emptyMessage={emptyMessage}
          choose={choose}
        />
      </CommandDialog>
    </>
  );
}
