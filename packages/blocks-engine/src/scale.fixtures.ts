/**
 * Generators for documents at the sizes the engine promises to handle.
 *
 * Kept beside the correctness corpus rather than inside a benchmark file
 * because more than one suite needs the same shapes: the performance gate, the
 * benchmark report, and the style compiler's own budget all measure against the
 * same thousand-node page, and comparing numbers is only meaningful when the
 * input is identical.
 *
 * Every generator is deterministic. Node ids, types and prop values are derived
 * from the index, so two runs produce byte-identical documents and a difference
 * in a measurement is a difference in the code.
 */
import type {
  BlockDocument,
  BlockNode,
  BreakpointSet,
  DocumentKind,
} from "./document";

/** Breakpoints the generated documents reference. */
export const SCALE_BREAKPOINTS: BreakpointSet = {
  viewport: [
    { id: "base", label: "Desktop" },
    { id: "tablet", label: "Tablet", maxWidth: 1024 },
    { id: "mobile", label: "Mobile", maxWidth: 640 },
  ],
  container: [{ id: "card-base", label: "Card" }],
};

/** Block types the generated documents use, cycled by index. */
const SCALE_TYPES: readonly string[] = [
  "core/section",
  "core/box",
  "core/heading",
  "core/paragraph",
];

export interface ScaleOptions {
  /** Total nodes in the document. */
  nodes: number;
  /** How deep the tree nests before starting a new branch. */
  depth?: number;
  /** Give every node styles across states and breakpoints. */
  styled?: boolean;
  kind?: DocumentKind;
}

function scaleNode(index: number, styled: boolean): BlockNode {
  const node: BlockNode = {
    id: `n${index}`,
    type: SCALE_TYPES[index % SCALE_TYPES.length] ?? "core/box",
    version: 1,
    props: { text: `Node ${index}`, level: (index % 6) + 1 },
  };
  if (!styled) return node;
  // Styles on both axes and several states, which is what makes a document
  // expensive to validate and to compile: the work is per state × breakpoint ×
  // property, not per node.
  node.styles = {
    base: {
      base: {
        padding: { blockStart: `${index % 32}px`, inlineStart: "1rem" },
        color: "#112233",
        fontSize: "1rem",
      },
      tablet: { padding: { blockStart: "8px" } },
      mobile: { fontSize: "0.875rem" },
    },
    hover: { base: { color: "#445566" } },
  };
  return node;
}

/**
 * A document of the requested size, nested to the requested depth and then
 * branching. Depth stays inside the engine's limit so the document is valid:
 * the point is to measure the cost of a large REAL page, not of a rejected one.
 */
export function scaleDocument(options: ScaleOptions): BlockDocument {
  const { nodes: total, depth = 6, styled = true, kind = "page" } = options;
  const roots: BlockNode[] = [];
  let created = 0;
  let branch: BlockNode[] = roots;
  let currentDepth = 0;
  while (created < total) {
    const node = scaleNode(created, styled);
    created += 1;
    branch.push(node);
    if (currentDepth < depth - 1 && created < total) {
      const children: BlockNode[] = [];
      node.slots = { children };
      branch = children;
      currentDepth += 1;
    } else {
      branch = roots;
      currentDepth = 0;
    }
  }
  return { formatVersion: 1, kind, nodes: roots };
}

/** The thousand-node page every budget in the program is quoted against. */
export function thousandNodePage(): BlockDocument {
  return scaleDocument({ nodes: 1000 });
}

/** The engine's node ceiling, for the smoke test at the limit. */
export function fiveThousandNodePage(): BlockDocument {
  return scaleDocument({ nodes: 5000 });
}

/**
 * A document whose nodes all carry a stale version, so migration has real work
 * to do on every one of them rather than short-circuiting.
 */
export function staleVersionPage(
  nodes: number,
  version: number
): BlockDocument {
  const doc = scaleDocument({ nodes, styled: false });
  const stamp = (list: BlockNode[]): void => {
    for (const node of list) {
      node.version = version;
      for (const children of Object.values(node.slots ?? {})) {
        if (Array.isArray(children)) stamp(children);
      }
    }
  };
  stamp(doc.nodes);
  return doc;
}
