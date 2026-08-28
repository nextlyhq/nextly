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

import type { BlockDocument } from "@nextlyhq/blocks-engine";

import type { BuilderCommand } from "./command-palette";
import { toolbarActions, type ToolbarActionId } from "./toolbar-actions";

/** The verbs a palette command needs, as `BlockKeyboardActions` publishes them. */
export interface CommandVerbs {
  readonly move: (direction: "up" | "down") => void;
  readonly delete: () => void;
  readonly duplicate: () => void;
  readonly selectParent: () => void;
}

/** Everything the command list is built from. */
export interface BuilderCommandsInput {
  readonly document: BlockDocument;
  readonly selectedId: string | null;
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
  document,
  selectedId,
  verbs,
  undo,
  redo,
  canUndo,
  canRedo,
  onExit,
}: BuilderCommandsInput): BuilderCommand[] {
  const run = blockActionRunners(verbs);

  const blockCommands = toolbarActions(document, selectedId)
    .filter(action => action.enabled)
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
