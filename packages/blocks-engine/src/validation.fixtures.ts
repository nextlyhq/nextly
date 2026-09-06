/**
 * The validation fixture corpus: documents paired with the exact issues they
 * should produce. This is the format's living spec — adversarial fixtures
 * assert precise (path, code) pairs, not just pass/fail, so a change in what
 * validation accepts is a visible change here.
 *
 * Not a test file itself; consumed by validation.test.ts. Kept as reusable
 * data rather than inline test cases so other suites can share the corpus.
 */
import { DOCUMENT_KINDS } from "./document";
import type { BlockDocument, BlockNode, BreakpointSet } from "./document";

/**
 * Coerce a deliberately-malformed shape to `BlockDocument` at the boundary.
 * Validation exists precisely to check untrusted input that does not satisfy
 * the type (database rows, agent output), so the invalid fixtures model that
 * input; this single named boundary keeps them free of scattered casts while
 * the valid fixtures stay fully type-checked.
 */
function invalid(doc: unknown): BlockDocument {
  return doc as BlockDocument;
}

/** A site breakpoint set the fixtures validate against. */
/**
 * A text node the renderer prunes, restricted to one audience.
 *
 * Named so each fixture using it reads as "these two share an anchor" rather
 * than restating what a condition envelope looks like, which is not what those
 * fixtures are about.
 */
function gatedText(id: string, cssId: string, tier: string): BlockNode {
  return {
    id,
    type: "core/text",
    version: 1,
    props: {},
    cssId,
    visibility: { conditions: [[{ field: "tier", op: "eq", value: tier }]] },
  };
}

export const FIXTURE_BREAKPOINTS: BreakpointSet = {
  viewport: [
    { id: "base", label: "Desktop" },
    { id: "tablet", label: "Tablet", maxWidth: 1024 },
    { id: "mobile", label: "Mobile", maxWidth: 640 },
  ],
  container: [
    { id: "card-base", label: "Card" },
    { id: "card-narrow", label: "Card narrow", maxWidth: 320 },
  ],
};

/** One expected issue: the (path, code) pair a fixture must produce. */
export interface ExpectedIssue {
  path: string;
  code: string;
}

export interface ValidationFixture {
  name: string;
  mode: "strict" | "forgiving";
  /** Set when the fixture exercises unknown-type checks. */
  registeredTypes?: string[];
  doc: BlockDocument;
  /** Exact issues expected (order-independent). Empty = a valid document. */
  expected: ExpectedIssue[];
}

// A small valid page reused as the base for several fixtures.
function validPage(): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "n1",
        type: "core/section",
        version: 1,
        props: {},
        slots: {
          children: [
            {
              id: "n2",
              type: "core/heading",
              version: 1,
              props: { text: "Hi" },
            },
          ],
        },
      },
    ],
  };
}

export const VALIDATION_FIXTURES: ValidationFixture[] = [
  {
    name: "a well-formed page has no issues",
    mode: "strict",
    doc: validPage(),
    expected: [],
  },
  {
    name: "a fully-featured node validates clean",
    mode: "strict",
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "root",
          type: "core/section",
          version: 2,
          props: {},
          classes: ["cls_hero"],
          attributes: { "data-role": "banner" },
          styles: {
            base: { base: { color: "#111" }, mobile: { color: "#222" } },
            hover: { "card-narrow": { color: "#333" } },
          },
          visibility: {
            conditions: [[{ field: "status", op: "eq", value: "vip" }]],
            devices: { mobile: false },
          },
          bindings: {
            title: { $bind: "title", source: "entry" },
            tagline: { $bind: "tagline", source: "single", sourceKey: "site" },
          },
        },
      ],
    },
    expected: [],
  },
  {
    name: "wrong format version",
    mode: "strict",
    doc: invalid({ ...validPage(), formatVersion: 2 }),
    expected: [{ path: "/formatVersion", code: "invalid-format-version" }],
  },
  {
    name: "unknown kind",
    mode: "strict",
    doc: invalid({ ...validPage(), kind: "widget" }),
    expected: [{ path: "/kind", code: "invalid-kind" }],
  },
  {
    name: "nodes not an array",
    mode: "strict",
    doc: invalid({ formatVersion: 1, kind: "page", nodes: {} }),
    expected: [{ path: "/nodes", code: "nodes-not-array" }],
  },
  {
    name: "missing node id",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "", type: "core/text", version: 1, props: {} }],
    }),
    expected: [{ path: "/nodes/0/id", code: "missing-node-id" }],
  },
  {
    name: "duplicate ids across nesting",
    mode: "strict",
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "dup",
          type: "core/section",
          version: 1,
          props: {},
          slots: {
            children: [{ id: "dup", type: "core/text", version: 1, props: {} }],
          },
        },
      ],
    },
    expected: [
      { path: "/nodes/0/slots/children/0/id", code: "duplicate-node-id" },
    ],
  },
  {
    name: "non-namespaced type",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: "heading", version: 1, props: {} }],
    }),
    expected: [{ path: "/nodes/0/type", code: "invalid-node-type" }],
  },
  {
    name: "non-integer version",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: "core/text", version: 1.5, props: {} }],
    }),
    expected: [{ path: "/nodes/0/version", code: "invalid-node-version" }],
  },
  {
    name: "props not an object",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: "core/text", version: 1, props: [] }],
    }),
    expected: [{ path: "/nodes/0/props", code: "invalid-props" }],
  },
  {
    name: "slot value not an array",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/section",
          version: 1,
          props: {},
          slots: { children: {} },
        },
      ],
    }),
    expected: [{ path: "/nodes/0/slots/children", code: "invalid-slots" }],
  },
  {
    name: "classes not string array",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "n1", type: "core/text", version: 1, props: {}, classes: [1] },
      ],
    }),
    expected: [{ path: "/nodes/0/classes", code: "invalid-classes" }],
  },
  {
    name: "a non-string cssId is rejected",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: "core/text", version: 1, props: {}, cssId: 5 }],
    }),
    expected: [{ path: "/nodes/0/cssId", code: "invalid-css-id" }],
  },
  {
    name: "an event-handler attribute is rejected as inline JS",
    mode: "strict",
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          attributes: { onclick: "alert(1)" },
        },
      ],
    },
    expected: [
      { path: "/nodes/0/attributes/onclick", code: "invalid-attributes" },
    ],
  },
  {
    name: "attributes not a string map",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          attributes: { tabindex: 0 },
        },
      ],
    }),
    expected: [{ path: "/nodes/0/attributes", code: "invalid-attributes" }],
  },
  {
    name: "slots not an object",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "n1", type: "core/section", version: 1, props: {}, slots: [] },
      ],
    }),
    expected: [{ path: "/nodes/0/slots", code: "invalid-slots" }],
  },
  {
    name: "style values not an object",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          styles: { base: { base: "red" } },
        },
      ],
    }),
    expected: [
      { path: "/nodes/0/styles/base/base", code: "invalid-style-values" },
    ],
  },
  {
    name: "visibility devices reference an unknown breakpoint",
    mode: "strict",
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          visibility: { devices: { wide: false } },
        },
      ],
    },
    expected: [
      {
        path: "/nodes/0/visibility/devices/wide",
        code: "unknown-breakpoint",
      },
    ],
  },
  {
    name: "unknown style state",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          styles: { visited: { base: { color: "#000" } } },
        },
      ],
    }),
    expected: [
      { path: "/nodes/0/styles/visited", code: "invalid-style-state" },
    ],
  },
  {
    name: "dangling breakpoint ref is an error in strict mode",
    mode: "strict",
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          styles: { base: { wide: { color: "#000" } } },
        },
      ],
    },
    expected: [
      { path: "/nodes/0/styles/base/wide", code: "unknown-breakpoint" },
    ],
  },
  {
    name: "dangling breakpoint ref is a warning in forgiving mode",
    mode: "forgiving",
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          styles: { base: { wide: { color: "#000" } } },
        },
      ],
    },
    expected: [
      { path: "/nodes/0/styles/base/wide", code: "unknown-breakpoint" },
    ],
  },
  {
    name: "malformed visibility conditions",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          visibility: { conditions: [{ field: "x" }] },
        },
      ],
    }),
    expected: [
      { path: "/nodes/0/visibility/conditions", code: "invalid-visibility" },
    ],
  },
  {
    name: "a null element in the nodes array is reported, not a crash",
    mode: "strict",
    doc: invalid({ formatVersion: 1, kind: "page", nodes: [null] }),
    expected: [{ path: "/nodes/0", code: "invalid-node" }],
  },
  {
    name: "a visibility condition without an operator is rejected",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          visibility: { conditions: [[{ field: "status" }]] },
        },
      ],
    }),
    expected: [
      { path: "/nodes/0/visibility/conditions", code: "invalid-visibility" },
    ],
  },
  {
    name: "a non-boolean visibility device value is rejected",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          visibility: { devices: { mobile: "false" } },
        },
      ],
    }),
    expected: [
      {
        path: "/nodes/0/visibility/devices/mobile",
        code: "invalid-visibility",
      },
    ],
  },
  {
    name: "single binding without sourceKey",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          bindings: { text: { $bind: "title", source: "single" } },
        },
      ],
    }),
    expected: [
      { path: "/nodes/0/bindings/text/sourceKey", code: "missing-source-key" },
    ],
  },
  {
    name: "document-level settings.styles are validated too",
    mode: "strict",
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [],
      settings: { styles: { base: { wide: { color: "#000" } } } },
    },
    expected: [
      { path: "/settings/styles/base/wide", code: "unknown-breakpoint" },
    ],
  },
  {
    name: "an expression-like binding path is rejected",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          bindings: { text: { $bind: "price * 2", source: "entry" } },
        },
      ],
    }),
    expected: [
      { path: "/nodes/0/bindings/text/$bind", code: "invalid-binding" },
    ],
  },
  {
    name: "sourceKey on a non-single binding is rejected",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          bindings: {
            text: { $bind: "title", source: "entry", sourceKey: "site" },
          },
        },
      ],
    }),
    expected: [
      { path: "/nodes/0/bindings/text/sourceKey", code: "invalid-binding" },
    ],
  },
  {
    name: "an unknown kind is a warning in forgiving mode",
    mode: "forgiving",
    doc: invalid({ ...validPage(), kind: "widget" }),
    expected: [{ path: "/kind", code: "invalid-kind" }],
  },
  {
    name: "malformed binding ($bind not a string)",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          bindings: { text: { $bind: 5 } },
        },
      ],
    }),
    expected: [{ path: "/nodes/0/bindings/text", code: "invalid-binding" }],
  },
  {
    name: "two nodes with the same cssId are a duplicate DOM id",
    mode: "strict",
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "n1", type: "core/text", version: 1, props: {}, cssId: "hero" },
        { id: "n2", type: "core/text", version: 1, props: {}, cssId: "hero" },
      ],
    },
    expected: [{ path: "/nodes/1/cssId", code: "duplicate-dom-id" }],
  },
  {
    name: "two GATED variants sharing one anchor are not a duplicate",
    mode: "strict",
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        // The case gating exists for: personalised variants of one section,
        // each carrying the same anchor, with exactly one ever served. The
        // renderer prunes both before markup, so the page holds neither.
        gatedText("n1", "hero", "pro"),
        gatedText("n2", "hero", "free"),
      ],
    },
    expected: [],
  },
  {
    name: "a gated node does not shield a VISIBLE duplicate",
    mode: "strict",
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        gatedText("n1", "hero", "pro"),
        { id: "n2", type: "core/text", version: 1, props: {}, cssId: "hero" },
        { id: "n3", type: "core/text", version: 1, props: {}, cssId: "hero" },
      ],
    },
    expected: [{ path: "/nodes/2/cssId", code: "duplicate-dom-id" }],
  },
  {
    name: "a SHADOWED attributes id does not collide with another node's",
    mode: "strict",
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        // Renders `actual`: the modelled field overwrites the bag, so `hero`
        // never reaches the page and cannot collide with anything.
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          cssId: "actual",
          attributes: { id: "hero" },
        },
        { id: "n2", type: "core/text", version: 1, props: {}, cssId: "hero" },
      ],
    },
    expected: [],
  },
  {
    name: "a cssId colliding with an attributes id is a duplicate DOM id",
    mode: "strict",
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "n1", type: "core/text", version: 1, props: {}, cssId: "hero" },
        {
          id: "n2",
          type: "core/text",
          version: 1,
          props: {},
          attributes: { id: "hero" },
        },
      ],
    },
    expected: [{ path: "/nodes/1/attributes/id", code: "duplicate-dom-id" }],
  },
  {
    name: "component instance with malformed props reports only invalid-props",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "nextly/component-instance",
          version: 1,
          props: null,
        },
      ],
    }),
    expected: [{ path: "/nodes/0/props", code: "invalid-props" }],
  },
  {
    name: "component instance without componentId",
    mode: "strict",
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "nextly/component-instance",
          version: 1,
          props: {},
        },
      ],
    },
    expected: [
      {
        path: "/nodes/0/props/componentId",
        code: "invalid-component-instance",
      },
    ],
  },
  {
    name: "unknown node type is an error in strict mode when a registry is present",
    mode: "strict",
    registeredTypes: ["core/section", "core/heading"],
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: "core/mystery", version: 1, props: {} }],
    },
    expected: [{ path: "/nodes/0/type", code: "unknown-node-type" }],
  },
  {
    name: "unknown node type is a warning in forgiving mode",
    mode: "forgiving",
    registeredTypes: ["core/section"],
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: "core/mystery", version: 1, props: {} }],
    },
    expected: [{ path: "/nodes/0/type", code: "unknown-node-type" }],
  },
];

// --- Scale and limit boundaries -------------------------------------------
// Each cap is exercised on both sides: at the limit a document is legal, one
// past it is not. A corpus that only tested the rejection would not notice a
// limit that had quietly become one too strict.

/** A chain `depth` levels deep, each level holding the next in its slot. */
function nestedChain(depth: number): BlockDocument {
  const root: BlockNode = { id: "d1", type: "core/box", version: 1, props: {} };
  let tip = root;
  for (let level = 2; level <= depth; level += 1) {
    const child: BlockNode = {
      id: `d${level}`,
      type: "core/box",
      version: 1,
      props: {},
    };
    tip.slots = { children: [child] };
    tip = child;
  }
  return { formatVersion: 1, kind: "page", nodes: [root] };
}

/** `count` sibling nodes at the top level. */
function flatSiblings(count: number): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: Array.from({ length: count }, (_unused, index) => ({
      id: `s${index}`,
      type: "core/box",
      version: 1,
      props: {},
    })),
  };
}

const LIMIT_FIXTURES: ValidationFixture[] = [
  {
    name: "a document nested to the depth limit is legal",
    mode: "strict",
    doc: nestedChain(12),
    expected: [],
  },
  {
    name: "one level past the depth limit is rejected",
    mode: "strict",
    doc: nestedChain(13),
    expected: [{ path: "/nodes", code: "depth-exceeded" }],
  },
  {
    name: "a document at the node ceiling is legal",
    mode: "strict",
    doc: flatSiblings(5000),
    expected: [],
  },
  {
    name: "one node past the ceiling is rejected",
    mode: "strict",
    doc: flatSiblings(5001),
    expected: [{ path: "/nodes", code: "node-count-exceeded" }],
  },
];

// --- Hostile content in props ---------------------------------------------
// Props are opaque to the engine: a block decides what its own props mean, and
// the renderer is what must escape them. These fixtures pin that the engine
// does not crash, mangle, or silently drop such content while walking it.

const HOSTILE_PROP_FIXTURES: ValidationFixture[] = [
  {
    name: "script-like and url-like prop values pass through validation",
    mode: "strict",
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/paragraph",
          version: 1,
          props: {
            text: "</style><script>alert(1)</script>",
            href: "javascript:alert(1)",
            data: "}; body { display: none }",
          },
        },
      ],
    },
    expected: [],
  },
  {
    name: "an inline event handler in attributes is still rejected",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          attributes: { onclick: "alert(1)" },
        },
      ],
    }),
    expected: [
      { path: "/nodes/0/attributes/onclick", code: "invalid-attributes" },
    ],
  },
];

// --- Writing systems -------------------------------------------------------
// Content is opaque bytes to the engine, and it has to stay that way: the
// logical style keys exist so one document serves both directions, which only
// holds if the document model itself is direction-agnostic.

const WRITING_SYSTEM_FIXTURES: ValidationFixture[] = [
  {
    name: "right-to-left content validates unchanged",
    mode: "strict",
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/heading",
          version: 1,
          props: { text: "مرحبا بالعالم", level: 1 },
        },
      ],
    },
    expected: [],
  },
  {
    name: "CJK content validates unchanged",
    mode: "strict",
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/heading",
          version: 1,
          props: { text: "ページビルダー", level: 2 },
        },
      ],
    },
    expected: [],
  },
  {
    name: "an id built from non-ASCII characters is accepted and deduplicated",
    mode: "strict",
    doc: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "ノード", type: "core/box", version: 1, props: {} },
        { id: "ノード", type: "core/box", version: 1, props: {} },
      ],
    },
    expected: [{ path: "/nodes/1/id", code: "duplicate-node-id" }],
  },
];

// --- Every document kind ---------------------------------------------------
// Derived from the vocabulary rather than listed beside it, so a kind ADDED to
// the enum arrives with coverage instead of quietly having none. What the list
// alone cannot see is a kind REMOVED — the fixture would vanish with it and
// every test would still pass — so the vocabulary itself is pinned by a test,
// which is where a change detector belongs.

const KIND_FIXTURES: ValidationFixture[] = DOCUMENT_KINDS.map(kind => ({
  name: `a ${kind} document validates`,
  mode: "strict" as const,
  doc: {
    formatVersion: 1,
    kind,
    nodes: [{ id: "n1", type: "core/box", version: 1, props: {} }],
  },
  expected: [],
}));

// --- The component definition envelope -------------------------------------
// In the CORPUS rather than only in the envelope's own suite, because the
// corpus is what asserts two properties no single test states: that every code
// a fixture emits is documented in ISSUE_CODES, and that every path emitted
// resolves as a JSON Pointer into the document it came from. The envelope's
// paths reach into `/exposed/0/nodeId` and `/slots/<id>/slot`, which are the
// first pointers in this format that address a document field outside `nodes`.

const COMPONENT_ENVELOPE_FIXTURES: ValidationFixture[] = [
  {
    name: "a component exposing a property of its own tree validates",
    mode: "strict",
    doc: {
      formatVersion: 1,
      kind: "component",
      nodes: [
        {
          id: "box",
          type: "core/box",
          version: 1,
          props: { heading: "Hello" },
          slots: { children: [] },
        },
      ],
      exposed: [
        {
          id: "heading",
          label: "Heading",
          nodeId: "box",
          propPath: "heading",
          type: "text",
        },
      ],
      slots: {
        body: { label: "Body", nodeId: "box", slot: "children" },
      },
    } as unknown as BlockDocument,
    expected: [],
  },
  {
    name: "a component exposing a node it does not contain is refused",
    mode: "strict",
    doc: invalid({
      formatVersion: 1,
      kind: "component",
      nodes: [{ id: "box", type: "core/box", version: 1, props: {} }],
      exposed: [
        {
          id: "heading",
          label: "Heading",
          nodeId: "deleted",
          propPath: "heading",
          type: "text",
        },
      ],
    }),
    expected: [{ path: "/exposed/0/nodeId", code: "exposed-node-missing" }],
  },
];

VALIDATION_FIXTURES.push(
  ...COMPONENT_ENVELOPE_FIXTURES,
  ...LIMIT_FIXTURES,
  ...HOSTILE_PROP_FIXTURES,
  ...WRITING_SYSTEM_FIXTURES,
  ...KIND_FIXTURES
);
