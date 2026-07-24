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
import {
  DEFAULT_LIMITS,
  LIMIT_WARNING_RATIO,
  countNodes,
  documentBytes,
  treeDepth,
} from "./limits";
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
  "nodes-not-array": "The document nodes field is not an array.",
  "depth-exceeded": "The node tree is nested deeper than the allowed maximum.",
  "node-count-exceeded":
    "The document has more nodes than the allowed maximum.",
  "document-too-large": "The serialized document exceeds the byte limit.",
  "document-size-warning":
    "The serialized document is approaching the byte limit.",
  "missing-node-id": "A node is missing its id or the id is empty.",
  "duplicate-node-id": "Two or more nodes share the same id.",
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
 * inspects data that may not match the declared types, so values are widened
 * to `unknown` at the point of reading and rendered here without risking
 * `[object Object]` or a throw.
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
  return JSON.stringify(value) ?? "";
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
  const knownBreakpoints = collectBreakpointIds(ctx.breakpoints, issues);

  // Read fields validation must scrutinise as untrusted: the declared type says
  // they are well-formed, but the whole job here is to catch when they are not.
  const formatVersion: unknown = doc.formatVersion;
  if (formatVersion !== DOCUMENT_FORMAT_VERSION) {
    issues.push({
      path: "/formatVersion",
      code: "invalid-format-version",
      severity: "error",
      message: `Unsupported document formatVersion ${describeValue(formatVersion)}.`,
      suggestion: `Use formatVersion ${DOCUMENT_FORMAT_VERSION}.`,
    });
  }

  if (!DOCUMENT_KINDS.includes(doc.kind)) {
    issues.push({
      path: "/kind",
      code: "invalid-kind",
      severity: "error",
      message: `Unknown document kind "${String(doc.kind)}".`,
      suggestion: `Use one of: ${DOCUMENT_KINDS.join(", ")}.`,
    });
  }

  if (!Array.isArray(doc.nodes)) {
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

  // Duplicate-id detection spans the whole forest, so gather ids with their
  // pointers first, then report every node that repeats an already-seen id.
  const seenIds = new Map<string, string>();
  const walkForValidation = (nodes: BlockNode[], basePath: string): void => {
    nodes.forEach((node, index) => {
      const path = pointer(basePath, index);
      validateNode(node, path, {
        ctx,
        issues,
        knownBreakpoints,
        unknownSeverity,
        seenIds,
      });
      if (node && typeof node === "object" && isPlainObject(node.slots)) {
        for (const [slot, children] of Object.entries(node.slots)) {
          if (Array.isArray(children)) {
            walkForValidation(children, pointer(pointer(path, "slots"), slot));
          }
        }
      }
    });
  };
  walkForValidation(doc.nodes, "/nodes");

  return issues;
}

/**
 * Collect every breakpoint id, reporting any id shared across the two axes.
 * This is the one check about the CONTEXT rather than the document: its issue
 * path (`/breakpoints/container/<i>`) points into the supplied breakpoint set,
 * not the validated document, because a cross-axis id collision is a site-
 * settings problem that makes every style breakpoint key ambiguous.
 */
function collectBreakpointIds(
  breakpoints: BreakpointSet,
  issues: ValidationIssue[]
): Set<string> {
  const ids = new Set<string>();
  const viewportIds = new Set(breakpoints.viewport.map(b => b.id));
  for (const def of breakpoints.viewport) ids.add(def.id);
  breakpoints.container.forEach((def, index) => {
    if (viewportIds.has(def.id)) {
      issues.push({
        path: pointer("/breakpoints/container", index),
        code: "breakpoint-id-not-unique",
        severity: "error",
        message: `Breakpoint id "${def.id}" is defined on both the viewport and container axes.`,
        suggestion: "Give viewport and container breakpoints distinct ids.",
      });
    }
    ids.add(def.id);
  });
  return ids;
}

function checkLimits(
  doc: BlockDocument,
  limits: DocumentLimits,
  issues: ValidationIssue[]
): void {
  const depth = treeDepth(doc.nodes);
  if (depth > limits.maxDepth) {
    issues.push({
      path: "/nodes",
      code: "depth-exceeded",
      severity: "error",
      message: `Node tree is ${depth} levels deep; the maximum is ${limits.maxDepth}.`,
    });
  }
  const nodeCount = countNodes(doc.nodes);
  if (nodeCount > limits.maxNodes) {
    issues.push({
      path: "/nodes",
      code: "node-count-exceeded",
      severity: "error",
      message: `Document has ${nodeCount} nodes; the maximum is ${limits.maxNodes}.`,
    });
  }
  const bytes = documentBytes(doc);
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
      code: "invalid-props",
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
  if (!isPlainObject(node.styles)) {
    state.issues.push({
      path: pointer(path, "styles"),
      code: "invalid-style-values",
      severity: "error",
      message: "A node styles field must be an object.",
    });
    return;
  }
  const stylesPath = pointer(path, "styles");
  for (const [stateKey, byBreakpoint] of Object.entries(node.styles)) {
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
    const ok =
      Array.isArray(vis.conditions) &&
      vis.conditions.every(
        group =>
          Array.isArray(group) &&
          group.every(
            c =>
              isPlainObject(c) &&
              typeof (c as { field?: unknown }).field === "string"
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
      for (const breakpointId of Object.keys(vis.devices)) {
        if (!state.knownBreakpoints.has(breakpointId)) {
          state.issues.push({
            path: pointer(pointer(visPath, "devices"), breakpointId),
            code: "unknown-breakpoint",
            severity: state.unknownSeverity,
            message: `Breakpoint "${breakpointId}" is not defined for this site.`,
          });
        }
      }
    }
  }
}

const BINDING_SOURCES = ["entry", "item", "single", "site"];

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
    if (
      !isPlainObject(binding) ||
      typeof (binding as { $bind?: unknown }).$bind !== "string"
    ) {
      issues.push({
        path: bPath,
        code: "invalid-binding",
        severity: "error",
        message: "A binding must be an object with a string $bind path.",
      });
      continue;
    }
    const source: unknown = (binding as { source?: unknown }).source;
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
    if (source === "single") {
      const sourceKey = (binding as { sourceKey?: unknown }).sourceKey;
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
    }
  }
}

function validateComponentInstance(
  node: BlockNode,
  path: string,
  issues: ValidationIssue[]
): void {
  if (node.type !== COMPONENT_INSTANCE_TYPE) return;
  const componentId = (node.props as { componentId?: unknown } | undefined)
    ?.componentId;
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
