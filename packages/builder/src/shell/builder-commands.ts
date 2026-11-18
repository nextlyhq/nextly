/**
 * What the editor's command palette can run.
 *
 * The palette is the third way to reach the same verbs, after the keystrokes
 * and the floating toolbar, and it is the one that answers "what can this
 * editor even do". A toolbar shows five icons at the block; a palette lists
 * every action by NAME, which is what someone who has never used this editor
 * searches with.
 *
 * ## Availability comes from the toolbar's rule, not a second one
 *
 * Whether a block can move, whether a lock forbids deleting it — every one of
 * those questions is already answered by `toolbarActions`, and asking them a
 * second time here is how a palette ends up offering a command that the button
 * beside it shows as unavailable. So the block verbs are DERIVED from that
 * list: same order, same enabling, same reasons.
 *
 * ## Why the labels differ from the toolbar's
 *
 * A toolbar button sits on the block it acts on, so "Duplicate" is unambiguous
 * there. A palette row is read in a list with no such context, so it names its
 * subject: "Duplicate block". The keywords carry the shorter word, so searching
 * "duplicate" still finds it.
 *
 * @module builder-commands
 */

import type { ToolbarAction, ToolbarActionId } from "../canvas/toolbar-actions";
import { CONVERSION_WORDS } from "../editor-words";
import { TURN_INTO_TARGETS } from "../turn-into-verb";

import type { BuilderCommand } from "./command-palette";

/** The verbs a palette command needs, as `BlockKeyboardActions` publishes them. */
export interface CommandVerbs {
  readonly move: (direction: "up" | "down") => void;
  readonly delete: () => void;
  readonly duplicate: () => void;
  /** Copy, Cut and Paste of blocks, through the clipboard. */
  readonly copy: () => void;
  readonly cut: () => void;
  readonly paste: () => void;
  /**
   * Copy one block's look, and give it to every selected block. Optional,
   * so a host built before them keeps compiling; absent, they do nothing.
   */
  readonly copyStyle?: () => void;
  readonly pasteStyle?: () => void;
  readonly selectParent: () => void;
  /**
   * Begin storing the selection in the pattern library.
   *
   * REQUIRED, like the four above it, and that is a decision rather than an
   * oversight. Nothing else here is a capability a host may lack, and making
   * this one optional produces the shape the totalised runner map exists to
   * prevent: a verb the bar offers with nothing bound to it, which reaches an
   * author as a button that does nothing. Required, the compiler names every
   * host that has to wire it.
   *
   * A host with no library to save into is a real case and not one there is a
   * second example of yet. Designing an availability model against a guess is
   * how a surface ends up with a control that is dimmed for a reason nobody can
   * phrase; when there is a second host it can be designed against that.
   */
  readonly saveAsPattern: () => void;
  /**
   * Open the selected placement's component in its own view. Silent when the
   * selection is not one placement or the host does not offer it, so it may
   * be pressed without asking first. Optional, so a host built before it
   * keeps compiling; absent, the verb does nothing.
   */
  readonly editComponent?: () => void;
  /**
   * Begin turning the selection into a component, replacing it with a
   * placement or keeping it and saving a copy; the host owns the form.
   */
  readonly turnIntoComponent?: () => void;
  /** Begin detaching the selected placement from its component. */
  readonly detachComponent?: () => void;
  /** Begin duplicating the selected placement's component. */
  readonly duplicateComponent?: () => void;
  /** Put the selected blocks in a new Box at their place. */
  readonly wrapInBox?: () => void;
  /** Replace the selected container by its blocks. */
  readonly unwrap?: () => void;
  /** Begin replacing a pattern's content with the selection. */
  readonly updatePattern?: () => void;
  /** Begin saving the block's look as a shared style; the host owns the form. */
  readonly saveAsSharedStyle?: () => void;
  /**
   * Turn the selected block into another type (`"core/heading"`), as one undo
   * step, saying what it removes. Optional, so a host built before it keeps
   * compiling; absent, the verb does nothing.
   */
  readonly turnInto?: (to: string) => void;
}

/** Everything the command list is built from. */
export interface BuilderCommandsInput {
  /**
   * What the bar would offer for this selection, from `toolbarActions`.
   *
   * Taken rather than derived, and that is what keeps availability DERIVED in
   * the sense that matters: the palette now shows exactly the list the toolbar
   * and the context menu are drawing, because it is the same array. Asked
   * separately it was a second call — one that could be given a narrower
   * question, which is how this surface came to offer a verb the bar refused —
   * and not a cheap one either, since deciding whether a selection can be saved
   * builds the document a save would store.
   */
  readonly actions: readonly ToolbarAction[];
  readonly verbs: CommandVerbs;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /**
   * Leaving the editor, when the host has somewhere to go.
   *
   * Optional for the same reason the shell's exit affordance is: the editor
   * mounts both standalone and embedded in a form that is already on screen,
   * and a palette offering "Close the editor" where nothing closes is a command
   * that does nothing.
   */
  readonly onExit?: () => void;
}

/** How each block verb is named and found in a list with no block beside it. */
const BLOCK_COMMAND_COPY: Record<
  ToolbarActionId,
  { label: string; keywords: readonly string[] }
> = {
  "select-parent": {
    label: "Select parent block",
    keywords: ["parent", "container", "up", "outer", "enclosing"],
  },
  "move-up": {
    label: "Move block up",
    keywords: ["move", "up", "before", "earlier", "reorder"],
  },
  "move-down": {
    label: "Move block down",
    keywords: ["move", "down", "after", "later", "reorder"],
  },
  duplicate: {
    label: "Duplicate block",
    keywords: ["duplicate", "copy", "clone", "repeat"],
  },
  // "Copy" and "Cut" put blocks on the clipboard; "Paste" places them where
  // a clicked block would land, on this page or another.
  copy: {
    label: "Copy block",
    keywords: ["copy", "clipboard"],
  },
  cut: {
    label: "Cut block",
    keywords: ["cut", "clipboard", "move"],
  },
  paste: {
    label: "Paste blocks",
    keywords: ["paste", "clipboard", "insert"],
  },
  // Named exactly as the menu names them: the words say what is copied.
  "copy-style": {
    label: "Copy style",
    keywords: ["copy style", "look", "format", "painter", "appearance"],
  },
  "paste-style": {
    label: "Paste style",
    keywords: ["paste style", "look", "format", "painter", "apply", "match"],
  },
  // Changing which of the three text blocks it is, kept apart in words from
  // turning a selection into a component.
  "turn-into-text": {
    label: "Turn block into Text",
    keywords: ["turn into", "convert", "change", "text", "paragraph"],
  },
  "turn-into-rich-text": {
    label: "Turn block into Rich text",
    keywords: ["turn into", "convert", "change", "rich text", "formatted"],
  },
  "turn-into-heading": {
    label: "Turn block into Heading",
    keywords: ["turn into", "convert", "change", "heading", "title"],
  },
  // The conversions are named with the bar's own words, so the palette and
  // the menus offer one verb for each.
  "save-as-pattern": {
    label: CONVERSION_WORDS.saveAsSection,
    // "pattern", "reuse" and "template" are what an author who has used
    // another builder searches with; they find it by those words too.
    keywords: [
      "save",
      "section",
      "saved sections",
      "pattern",
      "library",
      "reuse",
      "template",
      "snippet",
    ],
  },
  "save-as-shared-style": {
    label: "Save block as shared style",
    keywords: ["save", "shared style", "class", "reuse", "style", "preset"],
  },
  "edit-component": {
    label: "Edit component",
    keywords: ["component", "edit", "open", "original", "definition"],
  },
  // One verb for both ways of making a component, so the palette finds it
  // by the words of either.
  "turn-into-component": {
    label: CONVERSION_WORDS.turnIntoComponent,
    keywords: [
      "turn into",
      "convert",
      "save",
      "component",
      "library",
      "reuse",
      "symbol",
      "synced",
    ],
  },
  "detach-component": {
    label: CONVERSION_WORDS.detachFromComponent,
    keywords: ["detach", "unlink", "component", "plain", "break"],
  },
  "duplicate-component": {
    label: "Duplicate component",
    keywords: ["duplicate", "copy", "component", "fork", "variant"],
  },
  "update-pattern": {
    label: "Update a saved section from the selection",
    keywords: [
      "update",
      "section",
      "pattern",
      "replace",
      "overwrite",
      "save over",
    ],
  },
  "wrap-in-box": {
    label: "Wrap blocks in a box",
    keywords: ["wrap", "box", "group", "container", "nest"],
  },
  unwrap: {
    label: "Unwrap block (keep what's inside)",
    keywords: ["unwrap", "ungroup", "unnest", "remove container", "flatten"],
  },
  delete: {
    label: "Delete block",
    keywords: ["delete", "remove", "destroy", "clear"],
  },
};

/** The group the block verbs are listed under. */
export const BLOCK_GROUP = "Block";
/** The group undo and redo are listed under. */
export const HISTORY_GROUP = "History";
/** The group leaving the editor is listed under. */
export const EDITOR_GROUP = "Editor";

/**
 * What each toolbar action id actually RUNS.
 *
 * Published rather than kept inside the palette because the palette is no
 * longer the only surface over these verbs: the right-click menu offers the
 * same list, and a second copy of this map is how one surface comes to move a
 * block while another duplicates it. The AVAILABILITY of an action is
 * `toolbarActions`'s answer and the LABEL is the surface's own; this is the
 * third and last thing a surface needs, and the only one they can all share.
 *
 * Total over {@link ToolbarActionId}, so a verb added to the bar cannot reach a
 * surface with nothing bound to it — the compiler names the omission here.
 */
export function blockActionRunners(
  verbs: CommandVerbs
): Record<ToolbarActionId, () => void> {
  return {
    "select-parent": verbs.selectParent,
    "move-up": () => verbs.move("up"),
    "move-down": () => verbs.move("down"),
    duplicate: verbs.duplicate,
    copy: verbs.copy,
    cut: verbs.cut,
    paste: verbs.paste,
    "copy-style": () => verbs.copyStyle?.(),
    "paste-style": () => verbs.pasteStyle?.(),
    "turn-into-text": () =>
      verbs.turnInto?.(TURN_INTO_TARGETS["turn-into-text"]),
    "turn-into-rich-text": () =>
      verbs.turnInto?.(TURN_INTO_TARGETS["turn-into-rich-text"]),
    "turn-into-heading": () =>
      verbs.turnInto?.(TURN_INTO_TARGETS["turn-into-heading"]),
    "save-as-pattern": verbs.saveAsPattern,
    "save-as-shared-style": () => verbs.saveAsSharedStyle?.(),
    "edit-component": () => verbs.editComponent?.(),
    "turn-into-component": () => verbs.turnIntoComponent?.(),
    "detach-component": () => verbs.detachComponent?.(),
    "duplicate-component": () => verbs.duplicateComponent?.(),
    "update-pattern": () => verbs.updatePattern?.(),
    "wrap-in-box": () => verbs.wrapInBox?.(),
    unwrap: () => verbs.unwrap?.(),
    delete: verbs.delete,
  };
}

/**
 * The palette's commands for the current state.
 *
 * Unavailable commands are OMITTED rather than listed and disabled, which is
 * the opposite of what the toolbar does — and deliberately. A toolbar keeps one
 * shape so the control an author is aiming at does not move; a palette is
 * searched rather than aimed at, and a row that matches the search and then
 * refuses to run is worse there than one that was never offered.
 */
export function builderCommands({
  actions,
  verbs,
  undo,
  redo,
  canUndo,
  canRedo,
  onExit,
}: BuilderCommandsInput): BuilderCommand[] {
  const run = blockActionRunners(verbs);

  // Paste is offered whatever is selected, since with nothing selected it
  // lands at the end of the page; so it is added once, below, and not taken
  // from the selection's verbs.
  const blockCommands = actions
    .filter(action => action.enabled && action.id !== "paste")
    .map(action => {
      const copy = BLOCK_COMMAND_COPY[action.id];
      return {
        id: `block.${action.id}`,
        label: copy.label,
        group: BLOCK_GROUP,
        keywords: copy.keywords,
        run: run[action.id],
      };
    });

  blockCommands.push({
    id: "block.paste",
    label: BLOCK_COMMAND_COPY.paste.label,
    group: BLOCK_GROUP,
    keywords: BLOCK_COMMAND_COPY.paste.keywords,
    run: run.paste,
  });

  const history: BuilderCommand[] = [];
  if (canUndo) {
    history.push({
      id: "history.undo",
      label: "Undo",
      group: HISTORY_GROUP,
      keywords: ["undo", "revert", "back"],
      run: undo,
    });
  }
  if (canRedo) {
    history.push({
      id: "history.redo",
      label: "Redo",
      group: HISTORY_GROUP,
      keywords: ["redo", "again", "forward"],
      run: redo,
    });
  }

  const editor: BuilderCommand[] =
    onExit === undefined
      ? []
      : [
          {
            id: "editor.exit",
            label: "Close the editor",
            group: EDITOR_GROUP,
            keywords: ["close", "exit", "leave", "done", "back"],
            run: onExit,
          },
        ];

  return [...blockCommands, ...history, ...editor];
}
