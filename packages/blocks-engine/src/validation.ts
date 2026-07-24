/**
 * Document validation. Produces machine-readable issues so both humans and
 * agents can locate and fix problems: every issue carries a JSON-Pointer into
 * the document, a stable code from {@link ISSUE_CODES}, a message, and an
 * optional suggestion. This is the contract the AI repair loop (the
 * `validate_page` tool) wraps unchanged, and the same issue shape the style
 * compiler and custom-CSS validator emit in later plans.
 *
 * Runtime-free like the rest of the engine: it reads the document and a caller-
 * supplied context (breakpoints, mode, and — once it exists — a block-type
 * lookup); it never touches storage or a framework.
 */
import type { BlockDocument, BlockNode, BreakpointSet } from "./document";
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
  STYLE_STATES,
} from "./document";
import { DEFAULT_LIMITS, LIMIT_WARNING_RATIO, documentBytes } from "./limits";
import type { DocumentLimits } from "./limits";

/** Severity of a validation issue. `error` blocks a strict publish. */
export type IssueSeverity = "error" | "warning";

/** How strictly to validate. */
export type ValidationMode = "strict" | "forgiving";

/**
 * One validation finding. `path` is an RFC 6901 JSON-Pointer that resolves into
 * the validated document (e.g. `/nodes/0/slots/children/1/id`); `code` is a
 * stable machine key from {@link ISSUE_CODES}.
 */
export interface ValidationIssue {
  path: string;
  code: IssueCode;
  message: string;
  severity: IssueSeverity;
  suggestion?: string;
}

/**
 * A minimal block-type lookup. The boot registry (a later PR) satisfies this;
 * until then callers omit it and node-type existence is not checked (structure
 * still is). Keeping it an interface avoids coupling validation to the registry.
 */
export interface BlockTypeLookup {
  has(type: string): boolean;
}

/**
 * Everything validation needs beyond the document itself. The engine never
 * reads storage: the caller supplies the site breakpoints and mode, and
 * optionally a block-type lookup and non-default limits.
 */
export interface ValidationContext {
  breakpoints: BreakpointSet;
  mode: ValidationMode;
  registry?: BlockTypeLookup;
  limits?: DocumentLimits;
}

/**
 * The stable issue-code vocabulary, each with a one-line description. Tests
 * assert that every code emitted appears here and vice versa, so the repair-
 * loop vocabulary cannot drift silently.
 */
export const ISSUE_CODES = {
  "invalid-format-version":
    "The document formatVersion is not the supported version.",
  "invalid-kind": "The document kind is not one of the known kinds.",
  "invalid-document": "The document is not an object.",
  "nodes-not-array": "The document nodes field is not an array.",
  "invalid-node": "A node is not an object.",
  "depth-exceeded": "The node tree is nested deeper than the allowed maximum.",
  "node-count-exceeded":
    "The document has more nodes than the allowed maximum.",
  "document-too-large": "The serialized document exceeds the byte limit.",
  "document-size-warning":
    "The serialized document is approaching the byte limit.",
  "missing-node-id": "A node is missing its id or the id is empty.",
  "duplicate-node-id": "Two or more nodes share the same id.",
  "duplicate-dom-id": "Two or more nodes render the same HTML id.",
  "invalid-node-type": "A node type is missing or not a namespaced string.",
  "invalid-node-version":
    "A node version is missing or not a positive integer.",
  "invalid-props": "A node props field is not an object.",
  "invalid-slots": "A node slots field or one of its slot arrays is malformed.",
  "invalid-classes": "A node classes field is not an array of strings.",
  "invalid-attributes": "A node attributes field is not a string map.",
  "unknown-node-type": "A node type is not registered.",
  "invalid-style-state": "A style state key is not a known interactive state.",
  "invalid-style-values": "A style values entry is not an object.",
  "unknown-breakpoint":
    "A style or visibility breakpoint id is not defined for the site.",
  "breakpoint-id-not-unique":
    "A breakpoint id is defined on more than one axis.",
  "invalid-visibility": "A node visibility structure is malformed.",
  "invalid-binding": "A binding is malformed.",
  "missing-source-key":
    "A single-sourced binding does not name which single it reads.",
  "invalid-component-instance":
    "A component-instance node does not reference a component.",
} as const;

/** A stable validation issue code. */
export type IssueCode = keyof typeof ISSUE_CODES;

/** Escape a JSON-Pointer reference token (RFC 6901: `~` → `~0`, `/` → `~1`). */
function escapePointer(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Join a parent pointer with a child token. */
function pointer(parent: string, token: string | number): string {
  return `${parent}/${escapePointer(String(token))}`;
}

/** A node type is a namespaced slug, e.g. "core/heading". */
const NODE_TYPE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A safe string form of an untrusted value for issue messages. Validation
 * inspects data that may not match the declared types, so values are widened to
 * `unknown` at the point of reading. Objects and arrays are rendered as a short
 * label rather than serialized: a deeply nested value would make JSON.stringify
 * overflow, and messages never need the full structure.
 */
function describeValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return String(value);
  }
  return Array.isArray(value) ? "[array]" : "[object]";
}

/**
 * Validate a document. Returns every issue found (empty array = valid). In
 * `strict` mode, preservable-but-unknown problems (unknown node type, dangling
 * breakpoint reference) are errors; in `forgiving` mode they are warnings, so a
 * renderer can still show what it can. Structural corruption (missing ids,
 * malformed shapes, exceeded limits) is always an error.
 */
export function validate(
  doc: BlockDocument,
  ctx: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const limits = ctx.limits ?? DEFAULT_LIMITS;
  const unknownSeverity: IssueSeverity =
    ctx.mode === "strict" ? "error" : "warning";

  // A wholly-malformed document (null, an array, a primitive) is reported as a
  // structural issue rather than crashing on the field reads below. `rawDoc`
  // aliases the same value as `unknown`: reads through it are legitimately
  // untrusted, while `doc` keeps its declared type for the typed helper calls.
  const rawDoc: unknown = doc;
  if (!isPlainObject(rawDoc)) {
    issues.push({
      path: "",
      code: "invalid-document",
      severity: "error",
      message: "The document must be an object.",
    });
    return issues;
  }

  const knownBreakpoints = collectBreakpointIds(ctx.breakpoints, issues);

  const formatVersion = rawDoc.formatVersion;
  if (formatVersion !== DOCUMENT_FORMAT_VERSION) {
    issues.push({
      path: "/formatVersion",
      code: "invalid-format-version",
      severity: "error",
      message: `Unsupported document formatVersion ${describeValue(formatVersion)}.`,
      suggestion: `Use formatVersion ${DOCUMENT_FORMAT_VERSION}.`,
    });
  }

  // An unknown kind is preserved in forgiving mode (a warning) and rejected in
  // strict mode, matching the unknown-block-type policy.
  const kind = rawDoc.kind;
  if (!DOCUMENT_KINDS.includes(kind as (typeof DOCUMENT_KINDS)[number])) {
    issues.push({
      path: "/kind",
      code: "invalid-kind",
      severity: unknownSeverity,
      message: `Unknown document kind "${describeValue(kind)}".`,
      suggestion: `Use one of: ${DOCUMENT_KINDS.join(", ")}.`,
    });
  }

  if (!Array.isArray(rawDoc.nodes)) {
    issues.push({
      path: "/nodes",
      code: "nodes-not-array",
      severity: "error",
      message: "The document nodes field must be an array.",
    });
    // Nothing further to check without a node forest.
    return issues;
  }

  checkLimits(doc, limits, issues);

  const nodeState: NodeCheckState = {
    ctx,
    issues,
    knownBreakpoints,
    unknownSeverity,
    seenIds: new Map<string, string>(),
    seenDomIds: new Map<string, string>(),
  };

  // Document-level styles use the same envelope as node styles but have no
  // owning node, so validate them here or they would go unchecked.
  if (isPlainObject(rawDoc.settings) && rawDoc.settings.styles !== undefined) {
    validateStyleEnvelope(
      rawDoc.settings.styles,
      "/settings/styles",
      nodeState
    );
  }

  // Iterative breadth-first walk. It never recurses, so a document nested
  // arbitrarily deep cannot overflow the call stack — validation returns the
  // depth issue instead of throwing. It also stops after visiting maxNodes
  // nodes (the node-count issue is already recorded by checkLimits), so an
  // oversized document cannot make the walk do unbounded work.
  // Index-based reads (not .map/.forEach) so a sparse array's holes become
  // explicit undefined entries reported as invalid nodes, and the queue is
  // capped at maxNodes so an oversized forest cannot grow it without bound.
  const queue: Array<{ node: BlockNode; path: string }> = [];
  for (
    let i = 0;
    i < doc.nodes.length && queue.length <= limits.maxNodes;
    i++
  ) {
    queue.push({ node: doc.nodes[i], path: pointer("/nodes", i) });
  }
  for (let i = 0; i < queue.length && i < limits.maxNodes; i++) {
    const { node, path } = queue[i];
    validateNode(node, path, nodeState);
    if (isPlainObject(node) && isPlainObject(node.slots)) {
      for (const [slot, children] of Object.entries(node.slots)) {
        if (Array.isArray(children)) {
          const slotPath = pointer(pointer(path, "slots"), slot);
          for (
            let c = 0;
            c < children.length && queue.length <= limits.maxNodes;
            c++
          ) {
            queue.push({ node: children[c], path: pointer(slotPath, c) });
          }
        }
      }
    }
  }

  return issues;
}

/**
 * Collect every breakpoint id, reporting any id that repeats — whether within a
 * single axis or across the two. This is the one check about the CONTEXT rather
 * than the document: its issue path (`/breakpoints/<axis>/<i>`) points into the
 * supplied breakpoint set, not the validated document, because a duplicate id
 * is a site-settings problem that makes every flat style breakpoint key
 * ambiguous.
 */
function collectBreakpointIds(
  breakpoints: BreakpointSet,
  issues: ValidationIssue[]
): Set<string> {
  const ids = new Set<string>();
  // The breakpoint set comes from stored settings, so treat it as untrusted: a
  // null/malformed set or axis is skipped rather than dereferenced.
  const set: unknown = breakpoints;
  const scanAxis = (axis: "viewport" | "container"): void => {
    const defs = isPlainObject(set) ? set[axis] : undefined;
    if (!Array.isArray(defs)) return;
    defs.forEach((def, index) => {
      // A malformed definition (null, missing id) is skipped rather than
      // dereferenced; the settings layer validates the breakpoint set on save.
      const rawDef: unknown = def;
      if (!isPlainObject(rawDef) || typeof rawDef.id !== "string") return;
      const id = rawDef.id;
      if (ids.has(id)) {
        issues.push({
          path: pointer(pointer("/breakpoints", axis), index),
          code: "breakpoint-id-not-unique",
          severity: "error",
          message: `Breakpoint id "${id}" is defined more than once.`,
          suggestion: "Give every breakpoint a unique id across both axes.",
        });
      }
      ids.add(id);
    });
  };
  scanAxis("viewport");
  scanAxis("container");
  return ids;
}

/**
 * Count nodes and detect depth-exceedance in one bounded pass. An oversized
 * document costs O(maxNodes), not O(document): once the node cap is passed the
 * traversal stops (the document is already rejected) and the frontier is never
 * allowed to grow past the cap, so a rejected forest cannot exhaust memory.
 */
function measureForest(
  nodes: BlockNode[],
  maxNodes: number,
  maxDepth: number
): { count: number; exceededDepth: boolean } {
  let count = 0;
  let exceededDepth = false;
  const queue: Array<{ node: BlockNode; depth: number }> = [];
  for (let i = 0; i < nodes.length && queue.length <= maxNodes; i++) {
    queue.push({ node: nodes[i], depth: 1 });
  }
  for (let i = 0; i < queue.length; i++) {
    count++;
    const { node, depth } = queue[i];
    if (depth > maxDepth) exceededDepth = true;
    if (count > maxNodes) break; // already over the cap; no need to count more
    if (typeof node === "object" && node !== null && node.slots) {
      for (const children of Object.values(node.slots)) {
        if (!Array.isArray(children)) continue;
        for (let c = 0; c < children.length && queue.length <= maxNodes; c++) {
          queue.push({ node: children[c], depth: depth + 1 });
        }
      }
    }
  }
  return { count, exceededDepth };
}

function checkLimits(
  doc: BlockDocument,
  limits: DocumentLimits,
  issues: ValidationIssue[]
): void {
  const { count, exceededDepth } = measureForest(
    doc.nodes,
    limits.maxNodes,
    limits.maxDepth
  );
  if (exceededDepth) {
    issues.push({
      path: "/nodes",
      code: "depth-exceeded",
      severity: "error",
      message: `Node tree is nested deeper than the maximum of ${limits.maxDepth}.`,
    });
  }
  if (count > limits.maxNodes) {
    issues.push({
      path: "/nodes",
      code: "node-count-exceeded",
      severity: "error",
      message: `Document exceeds the maximum of ${limits.maxNodes} nodes.`,
    });
  }
  // A structurally over-cap document is already rejected; skip the O(n)
  // serialization so an oversized forest never gets stringified in full.
  if (exceededDepth || count > limits.maxNodes) return;

  // Serialization can throw on a document too deeply nested for JSON.stringify;
  // a validator must return an issue, never propagate that as an exception.
  let bytes: number;
  try {
    bytes = documentBytes(doc);
  } catch {
    issues.push({
      path: "",
      code: "document-too-large",
      severity: "error",
      message:
        "Document could not be serialized (too large or too deeply nested).",
    });
    return;
  }
  if (bytes > limits.maxBytes) {
    issues.push({
      path: "",
      code: "document-too-large",
      severity: "error",
      message: `Document is ${bytes} bytes; the maximum is ${limits.maxBytes}.`,
    });
  } else if (bytes > limits.maxBytes * LIMIT_WARNING_RATIO) {
    issues.push({
      path: "",
      code: "document-size-warning",
      severity: "warning",
      message: `Document is ${bytes} bytes, over ${Math.round(
        LIMIT_WARNING_RATIO * 100
      )}% of the ${limits.maxBytes}-byte limit.`,
    });
  }
}

interface NodeCheckState {
  ctx: ValidationContext;
  issues: ValidationIssue[];
  knownBreakpoints: Set<string>;
  unknownSeverity: IssueSeverity;
  seenIds: Map<string, string>;
  /** Non-empty DOM ids seen so far (from `cssId` or `attributes.id`) → pointer. */
  seenDomIds: Map<string, string>;
}

function validateNode(
  node: BlockNode,
  path: string,
  state: NodeCheckState
): void {
  const { issues } = state;
  if (!isPlainObject(node)) {
    issues.push({
      path,
      code: "invalid-node",
      severity: "error",
      message: "A node must be an object.",
    });
    return;
  }

  // id: present, non-empty, unique across the whole document.
  if (typeof node.id !== "string" || node.id.length === 0) {
    issues.push({
      path: pointer(path, "id"),
      code: "missing-node-id",
      severity: "error",
      message: "Every node needs a non-empty string id.",
    });
  } else {
    const firstSeenAt = state.seenIds.get(node.id);
    if (firstSeenAt !== undefined) {
      issues.push({
        path: pointer(path, "id"),
        code: "duplicate-node-id",
        severity: "error",
        message: `Node id "${node.id}" is already used at ${firstSeenAt}.`,
        suggestion: "Give every node a unique id.",
      });
    } else {
      state.seenIds.set(node.id, pointer(path, "id"));
    }
  }

  // type: namespaced slug, and — if a registry is supplied — registered.
  if (typeof node.type !== "string" || !NODE_TYPE_RE.test(node.type)) {
    issues.push({
      path: pointer(path, "type"),
      code: "invalid-node-type",
      severity: "error",
      message: `Node type "${String(node.type)}" must be a namespaced slug like "core/heading".`,
    });
  } else if (state.ctx.registry && !state.ctx.registry.has(node.type)) {
    issues.push({
      path: pointer(path, "type"),
      code: "unknown-node-type",
      severity: state.unknownSeverity,
      message: `Node type "${node.type}" is not registered.`,
      suggestion: "Register the block or remove the node.",
    });
  }

  // version: positive integer.
  if (
    typeof node.version !== "number" ||
    !Number.isInteger(node.version) ||
    node.version < 1
  ) {
    issues.push({
      path: pointer(path, "version"),
      code: "invalid-node-version",
      severity: "error",
      message: "A node version must be a positive integer.",
    });
  }

  if (!isPlainObject(node.props)) {
    issues.push({
      path: pointer(path, "props"),
      code: "invalid-props",
      severity: "error",
      message: "A node props field must be an object.",
    });
  }

  validateSlots(node, path, state);
  validateClasses(node, path, issues);
  validateAttributes(node, path, issues);
  validateStyles(node, path, state);
  validateVisibility(node, path, state);
  validateBindings(node, path, issues);
  validateComponentInstance(node, path, issues);
  validateDomIds(node, path, state);
}

/**
 * A rendered node's DOM id — from `cssId` or the `attributes.id` escape hatch —
 * must be unique across the document, or the page emits duplicate HTML `id`
 * attributes (breaking anchors, labels, and CSS selectors). Preservable, so the
 * severity follows the mode.
 */
function validateDomIds(
  node: BlockNode,
  path: string,
  state: NodeCheckState
): void {
  const report = (domId: string, at: string): void => {
    const firstAt = state.seenDomIds.get(domId);
    if (firstAt !== undefined) {
      state.issues.push({
        path: at,
        code: "duplicate-dom-id",
        severity: state.unknownSeverity,
        message: `HTML id "${domId}" is already used at ${firstAt}.`,
        suggestion: "Give each element a unique id.",
      });
    } else {
      state.seenDomIds.set(domId, at);
    }
  };
  if (typeof node.cssId === "string" && node.cssId.length > 0) {
    report(node.cssId, pointer(path, "cssId"));
  }
  if (isPlainObject(node.attributes)) {
    for (const [key, value] of Object.entries(node.attributes)) {
      if (key.toLowerCase() === "id" && typeof value === "string" && value) {
        report(value, pointer(pointer(path, "attributes"), key));
      }
    }
  }
}

function validateSlots(
  node: BlockNode,
  path: string,
  state: NodeCheckState
): void {
  if (node.slots === undefined) return;
  if (!isPlainObject(node.slots)) {
    state.issues.push({
      path: pointer(path, "slots"),
      code: "invalid-slots",
      severity: "error",
      message: "A node slots field must be an object of node arrays.",
    });
    return;
  }
  for (const [slot, children] of Object.entries(node.slots)) {
    if (!Array.isArray(children)) {
      state.issues.push({
        path: pointer(pointer(path, "slots"), slot),
        code: "invalid-slots",
        severity: "error",
        message: `Slot "${slot}" must be an array of nodes.`,
      });
    }
    // Child nodes themselves are validated by the recursive walk in validate().
  }
}

function validateClasses(
  node: BlockNode,
  path: string,
  issues: ValidationIssue[]
): void {
  if (node.classes === undefined) return;
  if (
    !Array.isArray(node.classes) ||
    !node.classes.every(c => typeof c === "string")
  ) {
    issues.push({
      path: pointer(path, "classes"),
      code: "invalid-classes",
      severity: "error",
      message: "A node classes field must be an array of class-id strings.",
    });
  }
}

function validateAttributes(
  node: BlockNode,
  path: string,
  issues: ValidationIssue[]
): void {
  if (node.attributes === undefined) return;
  if (
    !isPlainObject(node.attributes) ||
    !Object.values(node.attributes).every(v => typeof v === "string")
  ) {
    issues.push({
      path: pointer(path, "attributes"),
      code: "invalid-attributes",
      severity: "error",
      message: "A node attributes field must be a string-to-string map.",
    });
  }
}

function validateStyles(
  node: BlockNode,
  path: string,
  state: NodeCheckState
): void {
  if (node.styles === undefined) return;
  validateStyleEnvelope(node.styles, pointer(path, "styles"), state);
}

/**
 * Validate a `NodeStyles` envelope (states × breakpoints × values) at any path.
 * Shared by node styles and document-level `settings.styles`, which use the
 * same shape.
 */
function validateStyleEnvelope(
  styles: unknown,
  stylesPath: string,
  state: NodeCheckState
): void {
  if (!isPlainObject(styles)) {
    state.issues.push({
      path: stylesPath,
      code: "invalid-style-values",
      severity: "error",
      message: "A styles field must be an object.",
    });
    return;
  }
  for (const [stateKey, byBreakpoint] of Object.entries(styles)) {
    const statePath = pointer(stylesPath, stateKey);
    if (!STYLE_STATES.includes(stateKey as (typeof STYLE_STATES)[number])) {
      state.issues.push({
        path: statePath,
        code: "invalid-style-state",
        severity: "error",
        message: `"${stateKey}" is not a known style state.`,
        suggestion: `Use one of: ${STYLE_STATES.join(", ")}.`,
      });
      continue;
    }
    if (!isPlainObject(byBreakpoint)) {
      state.issues.push({
        path: statePath,
        code: "invalid-style-values",
        severity: "error",
        message: `Style state "${stateKey}" must map breakpoint ids to values.`,
      });
      continue;
    }
    for (const [breakpointId, values] of Object.entries(byBreakpoint)) {
      const bpPath = pointer(statePath, breakpointId);
      if (!state.knownBreakpoints.has(breakpointId)) {
        state.issues.push({
          path: bpPath,
          code: "unknown-breakpoint",
          severity: state.unknownSeverity,
          message: `Breakpoint "${breakpointId}" is not defined for this site.`,
        });
      }
      if (!isPlainObject(values)) {
        state.issues.push({
          path: bpPath,
          code: "invalid-style-values",
          severity: "error",
          message: `Style values at "${breakpointId}" must be an object.`,
        });
      }
    }
  }
}

function validateVisibility(
  node: BlockNode,
  path: string,
  state: NodeCheckState
): void {
  if (node.visibility === undefined) return;
  const vis = node.visibility;
  const visPath = pointer(path, "visibility");
  if (!isPlainObject(vis)) {
    state.issues.push({
      path: visPath,
      code: "invalid-visibility",
      severity: "error",
      message: "A node visibility field must be an object.",
    });
    return;
  }
  if (vis.conditions !== undefined) {
    // Each condition needs a string `field` AND a string `op`; the optional
    // `value` may be anything. Accepting a condition without an operator would
    // pass a shape downstream evaluation cannot act on.
    const ok =
      Array.isArray(vis.conditions) &&
      vis.conditions.every(
        group =>
          Array.isArray(group) &&
          group.every(
            c =>
              isPlainObject(c) &&
              typeof (c as { field?: unknown }).field === "string" &&
              typeof (c as { op?: unknown }).op === "string"
          )
      );
    if (!ok) {
      state.issues.push({
        path: pointer(visPath, "conditions"),
        code: "invalid-visibility",
        severity: "error",
        message:
          "visibility.conditions must be an OR-array of AND-arrays of {field, op, value?}.",
      });
    }
  }
  if (vis.devices !== undefined) {
    if (!isPlainObject(vis.devices)) {
      state.issues.push({
        path: pointer(visPath, "devices"),
        code: "invalid-visibility",
        severity: "error",
        message: "visibility.devices must map breakpoint ids to booleans.",
      });
    } else {
      for (const [breakpointId, value] of Object.entries(vis.devices)) {
        const devicePath = pointer(pointer(visPath, "devices"), breakpointId);
        if (!state.knownBreakpoints.has(breakpointId)) {
          state.issues.push({
            path: devicePath,
            code: "unknown-breakpoint",
            severity: state.unknownSeverity,
            message: `Breakpoint "${breakpointId}" is not defined for this site.`,
          });
        }
        // The stored shape is Record<breakpointId, boolean>; a truthy string or
        // number would render differently from the author's intent.
        if (typeof value !== "boolean") {
          state.issues.push({
            path: devicePath,
            code: "invalid-visibility",
            severity: "error",
            message: `visibility.devices["${breakpointId}"] must be a boolean.`,
          });
        }
      }
    }
  }
}

const BINDING_SOURCES = ["entry", "item", "single", "site"];

/**
 * A binding path is a dot-joined chain of field identifiers, e.g. "title" or
 * "author.name". This rejects expression-like or otherwise malformed strings
 * (never eval, per the binding design). The one-hop RELATION limit is semantic
 * and needs the schema, so it is enforced in the binding-resolution plan, not
 * here.
 */
const BIND_PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function validateBindings(
  node: BlockNode,
  path: string,
  issues: ValidationIssue[]
): void {
  if (node.bindings === undefined) return;
  if (!isPlainObject(node.bindings)) {
    issues.push({
      path: pointer(path, "bindings"),
      code: "invalid-binding",
      severity: "error",
      message: "A node bindings field must be an object keyed by prop name.",
    });
    return;
  }
  const bindingsPath = pointer(path, "bindings");
  for (const [prop, binding] of Object.entries(node.bindings)) {
    const bPath = pointer(bindingsPath, prop);
    // Check the shape BEFORE reading any field: a null/primitive binding value
    // must produce an issue, not a thrown property access.
    if (!isPlainObject(binding)) {
      issues.push({
        path: bPath,
        code: "invalid-binding",
        severity: "error",
        message: "A binding must be an object with a string $bind path.",
      });
      continue;
    }
    const bindPath = binding.$bind;
    if (typeof bindPath !== "string") {
      issues.push({
        path: bPath,
        code: "invalid-binding",
        severity: "error",
        message: "A binding must be an object with a string $bind path.",
      });
      continue;
    }
    if (!BIND_PATH_RE.test(bindPath)) {
      issues.push({
        path: pointer(bPath, "$bind"),
        code: "invalid-binding",
        severity: "error",
        message: `Binding path "${describeValue(bindPath)}" must be a dot-joined field path (never an expression).`,
      });
    }
    const source: unknown = binding.source;
    if (
      source !== undefined &&
      (typeof source !== "string" || !BINDING_SOURCES.includes(source))
    ) {
      issues.push({
        path: pointer(bPath, "source"),
        code: "invalid-binding",
        severity: "error",
        message: `Binding source "${describeValue(source)}" is not one of: ${BINDING_SOURCES.join(", ")}.`,
      });
    }
    const sourceKey = binding.sourceKey;
    if (source === "single") {
      if (typeof sourceKey !== "string" || sourceKey.length === 0) {
        issues.push({
          path: pointer(bPath, "sourceKey"),
          code: "missing-source-key",
          severity: "error",
          message:
            'A binding with source "single" must name the single via sourceKey.',
          suggestion: "Set sourceKey to the single's slug.",
        });
      }
    } else if (sourceKey !== undefined) {
      // sourceKey is reserved for single-sourced bindings; on any other source
      // it is an ambiguous, unresolvable field.
      issues.push({
        path: pointer(bPath, "sourceKey"),
        code: "invalid-binding",
        severity: "error",
        message: 'sourceKey is only allowed when source is "single".',
      });
    }
  }
}

function validateComponentInstance(
  node: BlockNode,
  path: string,
  issues: ValidationIssue[]
): void {
  if (node.type !== COMPONENT_INSTANCE_TYPE) return;
  // Only check componentId once props is an object: if props is missing or
  // malformed, `invalid-props` already covers it and a `/props/componentId`
  // pointer would target a location a fixer cannot edit.
  if (!isPlainObject(node.props)) return;
  const componentId = node.props.componentId;
  if (typeof componentId !== "string" || componentId.length === 0) {
    issues.push({
      path: pointer(pointer(path, "props"), "componentId"),
      code: "invalid-component-instance",
      severity: "error",
      message:
        "A component-instance node must set props.componentId to the component's id.",
    });
  }
}
