/**
 * The validation fixture corpus: documents paired with the exact issues they
 * should produce. This is the format's living spec — adversarial fixtures
 * assert precise (path, code) pairs, not just pass/fail, so a change in what
 * validation accepts is a visible change here.
 *
 * Not a test file itself; consumed by validation.test.ts. Kept as data so the
 * same corpus can seed the renderer and repair-loop suites in later plans.
 */
import type { BlockDocument, BreakpointSet } from "./document";

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
