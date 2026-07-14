/**
 * The editor's pure reducer (spec §9). Operates on a BlockDocument via the isomorphic
 * core tree ops, with bounded undo/redo history. Defaults for new nodes come from the
 * block registry — never a hard-coded list.
 */
import type { MotionConfig } from "../../core/motion";
import { defaultBlockRegistry } from "../../core/registry";
import {
  duplicateNode,
  findNode,
  insertNode,
  makeNode,
  moveNode,
  reidSubtree,
  removeNode,
  updateNode,
} from "../../core/tree";
import type {
  BlockDocument,
  BlockNode,
  Binding,
  StyleValues,
} from "../../core/types";

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

export function initialState(
  document: BlockDocument,
  customCss = ""
): EditorState {
  return {
    document,
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
  const def = defaultBlockRegistry.get(nodeType);
  const props = def ? structuredClone(def.defaultProps) : {};
  const style = def?.defaultStyle
    ? structuredClone(def.defaultStyle)
    : undefined;
  const slots = def?.isContainer ? { default: [] } : undefined;
  return makeNode(nodeType, props, style, slots);
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
      const node = createNodeFromType(action.nodeType);
      return commit(
        state,
        insertNode(root, action.parentId, action.slot, node, action.index),
        node.id
      );
    }

    case "MOVE":
      return commit(
        state,
        moveNode(root, action.id, action.parentId, action.slot, action.index)
      );

    case "REMOVE": {
      const next = removeNode(root, action.id);
      return { ...commit(state, next), selectedId: null };
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
      const fresh = reidSubtree(action.node);
      return commit(
        state,
        insertNode(root, action.parentId, action.slot, fresh, action.index),
        fresh.id
      );
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
