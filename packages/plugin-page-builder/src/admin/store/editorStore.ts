/**
 * The editor's pure reducer (spec §9). Operates on a BlockDocument via the isomorphic
 * core tree ops, with bounded undo/redo history. Defaults for new nodes come from the
 * block registry — never a hard-coded list.
 */
import {
  repairInvalidSlot,
  type InvalidSlotEntry,
} from "../../core/invalid-slots";
import { migrateDocument } from "../../core/migrate";
import type { MotionConfig } from "../../core/motion";
import { createNode, defaultBlockRegistry } from "../../core/registry";
import {
  duplicateNode,
  findNode,
  insertNode,
  moveNode,
  reidSubtree,
  removeNode,
  updateNode,
} from "../../core/tree";
import {
  MAX_DEPTH,
  MAX_NODES,
  type BlockDocument,
  type BlockNode,
  type Binding,
  type StyleValues,
} from "../../core/types";
import { validateDocument } from "../../core/validate";
import { canDrop } from "../logic/dropRules";

const HISTORY_LIMIT = 50;
const BASE_BREAKPOINT = "base";

export interface EditorState {
  document: BlockDocument;
  selectedId: string | null;
  activeBreakpoint: string;
  past: BlockDocument[];
  future: BlockDocument[];
  dirty: boolean;
  customCss: string;
}

/**
 * Whether a node of `childType` may sit in `parentId`'s `slot`.
 *
 * Applied in the REDUCER rather than at each call site, because "which slots accept which blocks"
 * is an invariant of the document and a caller is free to forget it. Drag-and-drop asks `canDrop`
 * through `planDrop`, and the library's Insert button asks it through `planInsert` — but paste,
 * keyboard reorder and anything added later reach the store directly, and a rule enforced on the
 * paths whoever wrote it was looking at is not a rule.
 *
 * A refused action leaves the state untouched. That is silent, which is not good enough on its own
 * and is much better than writing a document the save path will refuse: the surfaces that PLAN an
 * insertion pick an accepting target before dispatching, so this only fires for a route that did
 * not ask.
 */
function slotAccepts(
  root: BlockNode,
  parentId: string,
  slot: string,
  childType: string
): boolean {
  const parent = findNode(root, parentId);
  if (!parent) return false;
  return canDrop(parent.type, slot, childType, defaultBlockRegistry).ok;
}

/**
 * The starting state for a document just loaded into the editor.
 *
 * The document is MIGRATED on the way in. A block's `migrate` is the only thing that can bring a
 * stored instance up to what its current definition expects, and the editor is where that has to
 * happen: it is the surface that reads props into controls and the surface that writes the document
 * back, so a document opened here and saved is a document upgraded. Without it every `migrate` in
 * the catalogue is unreachable, and an instance written by an older definition is shown through
 * controls that no longer describe it.
 *
 * `dirty` stays false. Migration is not an edit the author made, and marking the page unsaved the
 * moment it opens would ask them to approve something they did not do — the upgrade rides along
 * with their first real change instead.
 */
export function initialState(
  document: BlockDocument,
  customCss = ""
): EditorState {
  return {
    document: migrateDocument(document, defaultBlockRegistry),
    selectedId: null,
    activeBreakpoint: BASE_BREAKPOINT,
    past: [],
    future: [],
    dirty: false,
    customCss,
  };
}

export type EditorAction =
  | { type: "SELECT"; id: string | null }
  | { type: "SET_BREAKPOINT"; breakpoint: string }
  | {
      type: "ADD";
      parentId: string;
      slot: string;
      nodeType: string;
      index: number;
    }
  | { type: "MOVE"; id: string; parentId: string; slot: string; index: number }
  | { type: "REMOVE"; id: string }
  /**
   * Apply the repair the core prescribes for one invalid-slot fault.
   *
   * The action carries the FAULT rather than the operation, because which operation a fault needs
   * is a property of the fault. `repairInvalidSlot` decides it and builds the tree; an action per
   * operation would put that same decision in the editor as well — two switches on one union, in
   * two layers, drifting silently because a wrong pairing still type-checks.
   *
   * An action rather than a direct call, so a repair joins undo history like any other edit.
   */
  | { type: "REPAIR_INVALID_SLOT"; entry: InvalidSlotEntry }
  | { type: "DUPLICATE"; id: string }
  | { type: "UPDATE_PROPS"; id: string; props: Record<string, unknown> }
  | {
      type: "UPDATE_STYLE";
      id: string;
      breakpoint: string;
      style: StyleValues;
      /** Which state to write — normal (default) or hover. */
      styleState?: "normal" | "hover";
    }
  | { type: "SET_BINDING"; id: string; prop: string; binding: Binding | null }
  | { type: "SET_CUSTOM_CLASS"; id: string; customClass: string }
  | { type: "SET_BLOCK_CSS"; id: string; css: string }
  | { type: "SET_CSS_ID"; id: string; cssId: string }
  | { type: "SET_ATTRIBUTES"; id: string; attributes: Record<string, string> }
  | {
      type: "SET_VISIBILITY";
      id: string;
      breakpoint: string;
      visible: boolean;
    }
  | { type: "SET_NAME"; id: string; name: string }
  | { type: "SET_LOCKED"; id: string; locked: boolean }
  | { type: "SET_MOTION"; id: string; motion: MotionConfig }
  | {
      type: "PASTE_NODE";
      parentId: string;
      slot: string;
      index: number;
      node: BlockNode;
    }
  | {
      type: "PASTE_STYLE";
      id: string;
      style?: BlockNode["style"];
      styleHover?: BlockNode["styleHover"];
    }
  | { type: "SET_PAGE_CUSTOM_CSS"; customCss: string }
  | { type: "REPLACE"; document: BlockDocument }
  | { type: "MARK_SAVED" }
  | { type: "UNDO" }
  | { type: "REDO" };

/** Blocks in this tree, counting the node itself. */
function nodeCount(node: BlockNode): number {
  let total = 1;
  for (const children of Object.values(node.slots ?? {})) {
    for (const child of children) total += nodeCount(child);
  }
  return total;
}

/** Levels this tree occupies, counting the node itself as one. */
function depthOf(node: BlockNode): number {
  let deepest = 1;
  for (const children of Object.values(node.slots ?? {})) {
    for (const child of children)
      deepest = Math.max(deepest, 1 + depthOf(child));
  }
  return deepest;
}

/** Keep a selection only if the id still resolves in the given document. */
function keepValidSelection(
  document: BlockDocument,
  selectedId: string | null
): string | null {
  if (!selectedId) return null;
  return findNode(document.root, selectedId) ? selectedId : null;
}

/** Build a fresh node for `type` from the registry's declared defaults. */
export function createNodeFromType(nodeType: string): BlockNode {
  return createNode(nodeType, defaultBlockRegistry);
}

/** Commit a new root: push current onto history (bounded), clear redo, mark dirty. */
function commit(
  state: EditorState,
  root: BlockNode,
  selectedId = state.selectedId
): EditorState {
  const past = [...state.past, state.document].slice(-HISTORY_LIMIT);
  return {
    ...state,
    document: { ...state.document, root },
    past,
    future: [],
    dirty: true,
    selectedId,
  };
}

export function editorReducer(
  state: EditorState,
  action: EditorAction
): EditorState {
  const root = state.document.root;

  switch (action.type) {
    case "SELECT":
      return { ...state, selectedId: action.id };

    case "SET_BREAKPOINT":
      return { ...state, activeBreakpoint: action.breakpoint };

    case "ADD": {
      if (!slotAccepts(root, action.parentId, action.slot, action.nodeType)) {
        return state;
      }
      const node = createNodeFromType(action.nodeType);
      return commit(
        state,
        insertNode(root, action.parentId, action.slot, node, action.index),
        node.id
      );
    }

    case "MOVE": {
      const moving = findNode(root, action.id);
      if (
        !moving ||
        !slotAccepts(root, action.parentId, action.slot, moving.type)
      ) {
        return state;
      }
      return commit(
        state,
        moveNode(root, action.id, action.parentId, action.slot, action.index)
      );
    }

    case "REMOVE": {
      const next = removeNode(root, action.id);
      return { ...commit(state, next), selectedId: null };
    }

    case "REPAIR_INVALID_SLOT": {
      const next = repairInvalidSlot(root, action.entry, defaultBlockRegistry);
      // A repair that REMOVES may take the selection with it; one that WRAPS keeps the block the
      // author is looking at. Asked of the tree the repair produced, so the reducer never has to
      // know which one ran.
      const selectedId = keepValidSelection(
        { ...state.document, root: next },
        state.selectedId
      );
      return commit(state, next, selectedId);
    }

    case "DUPLICATE":
      return commit(state, duplicateNode(root, action.id));

    case "UPDATE_PROPS": {
      const node = findNode(root, action.id);
      const props = { ...(node?.props ?? {}), ...action.props };
      return commit(state, updateNode(root, action.id, { props }));
    }

    case "UPDATE_STYLE": {
      const node = findNode(root, action.id);
      const key = action.styleState === "hover" ? "styleHover" : "style";
      const style = { ...(node?.[key] ?? {}) };
      style[action.breakpoint] = {
        ...(style[action.breakpoint] ?? {}),
        ...action.style,
      };
      return commit(state, updateNode(root, action.id, { [key]: style }));
    }

    case "SET_BINDING": {
      const node = findNode(root, action.id);
      const bindings = { ...(node?.bindings ?? {}) };
      if (action.binding) bindings[action.prop] = action.binding;
      else delete bindings[action.prop];
      return commit(state, updateNode(root, action.id, { bindings }));
    }

    case "SET_CUSTOM_CLASS": {
      const customClass = action.customClass.trim() || undefined;
      return commit(state, updateNode(root, action.id, { customClass }));
    }

    case "SET_BLOCK_CSS": {
      const customCss = action.css.trim() || undefined;
      return commit(state, updateNode(root, action.id, { customCss }));
    }

    case "SET_CSS_ID": {
      const cssId = action.cssId.trim() || undefined;
      return commit(state, updateNode(root, action.id, { cssId }));
    }

    case "SET_ATTRIBUTES":
      return commit(
        state,
        updateNode(root, action.id, { attributes: action.attributes })
      );

    case "SET_VISIBILITY": {
      const node = findNode(root, action.id);
      const visibility = {
        ...(node?.visibility ?? {}),
        [action.breakpoint]: action.visible,
      };
      return commit(state, updateNode(root, action.id, { visibility }));
    }

    case "SET_NAME": {
      const name = action.name.trim() || undefined;
      return commit(state, updateNode(root, action.id, { name }));
    }

    case "SET_LOCKED":
      return commit(
        state,
        updateNode(root, action.id, { locked: action.locked })
      );

    case "SET_MOTION":
      return commit(
        state,
        updateNode(root, action.id, { motion: action.motion })
      );

    case "PASTE_NODE": {
      if (!slotAccepts(root, action.parentId, action.slot, action.node.type)) {
        return state;
      }
      const fresh = reidSubtree(action.node);
      const pasted = insertNode(
        root,
        action.parentId,
        action.slot,
        fresh,
        action.index
      );
      // The clipboard is the one insertion path whose payload was built somewhere else, so the
      // destination admitting the outermost block says nothing about the rest of the tree. The
      // result is checked against the same invariants the save path enforces — a walk over
      // parent/child pairs cannot see a fault that is not a pair, such as an empty undeclared slot
      // on a leaf.
      //
      // Compared against the document as it WAS, not judged on its own. `validateDocument` reports
      // the FIRST fault anywhere in the tree, and this PR creates pages that already have one: a
      // stored `core/columns` row holding ordinary blocks stays that way until its author takes
      // the repair. Judging only the result would refuse every unrelated paste while such a row
      // exists, silently, so the Paste action would look broken on exactly the pages this change
      // affects.
      //
      // A page that was ALREADY unsaveable stays editable. That is deliberate: it cannot be made
      // more unsaveable, the banner already reports what is wrong with it, and blocking the edits
      // that would help fix it is the defect this avoids rather than a risk it takes.
      const before = validateDocument(state.document, defaultBlockRegistry, {
        allowUnknown: true,
      });
      const after = validateDocument(
        { ...state.document, root: pasted },
        defaultBlockRegistry,
        { allowUnknown: true }
      );
      if (before === true && after !== true) return state;
      // The LIMITS are enforced whatever the page's prior state, because they are the one fault
      // the repair banner cannot offer an action for: a slot violation is listed with a Remove or
      // a Wrap, and "this document holds too many nodes" is listed by nothing. Letting a paste
      // past them on an already-faulty page means that after the author repairs what the banner
      // DOES show, the page is still unsaveable with nothing left pointing at why.
      //
      // Checked directly rather than by reading `after`, which reports only the FIRST fault — on a
      // page that already had one, a limit the paste just broke is never the fault it names.
      // `depthOf` counts the root as one level; `validate` counts it as zero and rejects only
      // `depth > MAX_DEPTH`. Comparing the two conventions directly refuses a paste the save path
      // would have accepted — a silent no-op on a legal edit, which is the failure this check is
      // supposed to prevent rather than cause.
      if (nodeCount(pasted) > MAX_NODES || depthOf(pasted) - 1 > MAX_DEPTH) {
        return state;
      }
      return commit(state, pasted, fresh.id);
    }

    case "PASTE_STYLE": {
      const node = findNode(root, action.id);
      if (!node) return state;
      return commit(
        state,
        updateNode(root, action.id, {
          style: action.style ?? node.style,
          styleHover: action.styleHover ?? node.styleHover,
        })
      );
    }

    case "SET_PAGE_CUSTOM_CSS":
      return { ...state, customCss: action.customCss, dirty: true };

    case "REPLACE":
      return {
        ...initialState(action.document, state.customCss),
        activeBreakpoint: state.activeBreakpoint,
      };

    case "MARK_SAVED":
      return { ...state, dirty: false };

    case "UNDO": {
      if (!state.past.length) return state;
      const prev = state.past[state.past.length - 1];
      return {
        ...state,
        document: prev,
        selectedId: keepValidSelection(prev, state.selectedId),
        past: state.past.slice(0, -1),
        future: [state.document, ...state.future],
        dirty: true,
      };
    }

    case "REDO": {
      if (!state.future.length) return state;
      const next = state.future[0];
      return {
        ...state,
        document: next,
        selectedId: keepValidSelection(next, state.selectedId),
        past: [...state.past, state.document],
        future: state.future.slice(1),
        dirty: true,
      };
    }

    default:
      return state;
  }
}
