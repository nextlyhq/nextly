import { describe, expect, it } from "vitest";

import type { BlockDocument, BreakpointSet } from "./document";
import { documentBytes } from "./limits";
import {
  FIXTURE_BREAKPOINTS,
  VALIDATION_FIXTURES,
} from "./validation.fixtures";
import type { BlockTypeLookup } from "./validation";
import { ISSUE_CODES, validate } from "./validation";

function lookup(types: string[]): BlockTypeLookup {
  const set = new Set(types);
  return { has: type => set.has(type) };
}

/** Coerce deliberately-malformed input to BlockDocument for the validator. */
function invalidDoc(doc: unknown): BlockDocument {
  return doc as BlockDocument;
}

/** Resolve an RFC 6901 JSON-Pointer against a value; undefined if it misses. */
function resolvePointer(root: unknown, path: string): unknown {
  if (path === "") return root;
  let current: unknown = root;
  for (const rawToken of path.split("/").slice(1)) {
    const token = rawToken.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      current = current[Number(token)];
    } else if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return current;
}

describe("style values reach the catalog through validate()", () => {
  function docWithStyles(styles: unknown): BlockDocument {
    return invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          styles: { base: { base: styles } },
        },
      ],
    });
  }

  it("reports an unknown style property", () => {
    const issues = validate(docWithStyles({ nope: "1px" }), {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
    });
    const issue = issues.find(i => i.code === "unknown-style-property");
    expect(issue?.path).toBe("/nodes/0/styles/base/base/nope");
  });

  it("reports a value that does not match its property's shape", () => {
    const issues = validate(docWithStyles({ textAlign: "left" }), {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
    });
    expect(issues.map(i => i.code)).toContain("invalid-style-value");
  });

  it("reports an unsafe value before it could reach a stylesheet", () => {
    const issues = validate(
      docWithStyles({ backgroundGradient: 'url("javascript:alert(1)")' }),
      { breakpoints: FIXTURE_BREAKPOINTS, mode: "strict" }
    );
    const issue = issues.find(i => i.code === "invalid-style-value");
    expect(issue?.path).toBe("/nodes/0/styles/base/base/backgroundGradient");
  });

  it("accepts a well-formed style block", () => {
    const issues = validate(
      docWithStyles({
        padding: { blockStart: "2rem" },
        color: { $token: "color.primary" },
        textAlign: "start",
      }),
      { breakpoints: FIXTURE_BREAKPOINTS, mode: "strict" }
    );
    expect(issues).toEqual([]);
  });

  it("downgrades an unknown property to a warning when forgiving", () => {
    const issues = validate(docWithStyles({ nope: "1px" }), {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "forgiving",
    });
    const issue = issues.find(i => i.code === "unknown-style-property");
    expect(issue?.severity).toBe("warning");
  });
});

describe("style validation through validate() is bounded", () => {
  it("stops at the budget instead of building an issue for every key", () => {
    // The budget only helps if `validate()` actually passes it: exercised here
    // through the real document path rather than by calling the style
    // validator directly.
    const styles: Record<string, string> = {};
    for (let index = 0; index < 5000; index += 1) styles[`k${index}`] = "1px";
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          styles: { base: { base: styles } },
        },
      ],
    });
    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
    });
    expect(issues.length).toBeLessThan(500);
    expect(issues.some(issue => issue.code === "style-issues-truncated")).toBe(
      true
    );
  });
});

describe("the style budget covers the envelope's own keys", () => {
  it("bounds a document carrying very many unknown style states", () => {
    // The keys of the envelope are as unbounded as the values inside it, so a
    // budget applied only at the property level leaves this path open.
    const states: Record<string, unknown> = {};
    for (let index = 0; index < 5000; index += 1) {
      states[`state${index}`] = { base: {} };
    }
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "n1", type: "core/box", version: 1, props: {}, styles: states },
      ],
    });
    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
    });
    expect(issues.length).toBeLessThan(500);
    expect(issues.some(issue => issue.code === "style-issues-truncated")).toBe(
      true
    );
  });
});

describe("validation fixture corpus", () => {
  for (const fixture of VALIDATION_FIXTURES) {
    it(fixture.name, () => {
      const issues = validate(fixture.doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: fixture.mode,
        registry: fixture.registeredTypes
          ? lookup(fixture.registeredTypes)
          : undefined,
      });
      // Assert the exact (path, code) set — order-independent.
      const actual = issues.map(i => `${i.path}\t${i.code}`).sort();
      const expected = fixture.expected.map(e => `${e.path}\t${e.code}`).sort();
      expect(actual).toEqual(expected);
    });
  }
});

describe("issue-code vocabulary is stable and complete", () => {
  it("every code emitted by the corpus is documented in ISSUE_CODES", () => {
    for (const fixture of VALIDATION_FIXTURES) {
      const issues = validate(fixture.doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: fixture.mode,
        registry: fixture.registeredTypes
          ? lookup(fixture.registeredTypes)
          : undefined,
      });
      for (const issue of issues) {
        expect(ISSUE_CODES).toHaveProperty(issue.code);
      }
    }
  });

  it("every documented code is a non-empty description", () => {
    for (const [code, description] of Object.entries(ISSUE_CODES)) {
      expect(description.length, `${code} needs a description`).toBeGreaterThan(
        0
      );
    }
  });
});

describe("every issue carries a JSON-Pointer anchored in the document", () => {
  it("each emitted path resolves, or (for a missing field) its parent does", () => {
    for (const fixture of VALIDATION_FIXTURES) {
      const issues = validate(fixture.doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: fixture.mode,
        registry: fixture.registeredTypes
          ? lookup(fixture.registeredTypes)
          : undefined,
      });
      for (const issue of issues) {
        // Document-level issues (size) use the empty root pointer; breakpoint
        // config issues point into the context, not the document.
        if (issue.path === "" || issue.path.startsWith("/breakpoints"))
          continue;
        const resolved = resolvePointer(fixture.doc, issue.path);
        if (resolved !== undefined) continue;
        // A "missing field" issue addresses an absent leaf, telling a fixer
        // WHERE the field belongs; its parent location must resolve.
        const parentPath = issue.path.slice(0, issue.path.lastIndexOf("/"));
        const parent =
          parentPath === ""
            ? fixture.doc
            : resolvePointer(fixture.doc, parentPath);
        expect(
          parent,
          `${fixture.name}: neither ${issue.path} nor its parent (${issue.code}) resolved`
        ).not.toBeUndefined();
      }
    }
  });
});

describe("severity depends on mode for preservable problems", () => {
  const danglingDoc: BlockDocument = {
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
  };

  it("dangling breakpoint ref is an error in strict, a warning in forgiving", () => {
    const strict = validate(danglingDoc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
    });
    expect(strict[0]?.severity).toBe("error");
    const forgiving = validate(danglingDoc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "forgiving",
    });
    expect(forgiving[0]?.severity).toBe("warning");
  });

  it("structural corruption is an error in both modes", () => {
    const broken: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "", type: "core/text", version: 1, props: {} }],
    };
    for (const mode of ["strict", "forgiving"] as const) {
      const issues = validate(broken, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode,
      });
      expect(issues.every(i => i.severity === "error")).toBe(true);
    }
  });
});

describe("breakpoint sets are validated for duplicate ids", () => {
  it("reports a breakpoint id shared by the viewport and container axes", () => {
    const collidingSet: BreakpointSet = {
      viewport: [
        { id: "base", label: "Desktop" },
        { id: "sm", label: "Small" },
      ],
      container: [{ id: "sm", label: "Card small" }],
    };
    const issues = validate(
      { formatVersion: 1, kind: "page", nodes: [] },
      { breakpoints: collidingSet, mode: "strict" }
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("breakpoint-id-not-unique");
    expect(issues[0]?.path).toBe("/breakpoints/container/0");
    expect(issues[0]?.severity).toBe("error");
  });

  it("reports a breakpoint id repeated within a single axis", () => {
    const dupWithinAxis: BreakpointSet = {
      viewport: [
        { id: "base", label: "Desktop" },
        { id: "mobile", label: "Mobile", maxWidth: 640 },
        { id: "mobile", label: "Mobile again", maxWidth: 480 },
      ],
      container: [],
    };
    const issues = validate(
      { formatVersion: 1, kind: "page", nodes: [] },
      { breakpoints: dupWithinAxis, mode: "strict" }
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("breakpoint-id-not-unique");
    expect(issues[0]?.path).toBe("/breakpoints/viewport/2");
  });
});

describe("validation never throws on adversarial input", () => {
  it("returns a depth issue for a document nested far beyond any stack limit", () => {
    // Build a chain ~20k deep — enough to overflow a recursive walk or
    // JSON.stringify. Validation must return issues, not throw.
    let node: Record<string, unknown> = {
      id: "leaf",
      type: "core/text",
      version: 1,
      props: {},
    };
    for (let i = 0; i < 20_000; i++) {
      node = {
        id: `n${i}`,
        type: "core/section",
        version: 1,
        props: {},
        slots: { children: [node] },
      };
    }
    const doc = {
      formatVersion: 1,
      kind: "page",
      nodes: [node],
    } as BlockDocument;
    let issues: ReturnType<typeof validate> = [];
    expect(() => {
      issues = validate(doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
      });
    }).not.toThrow();
    expect(issues.some(i => i.code === "depth-exceeded")).toBe(true);
  });

  it("returns issues for a nodes array full of malformed elements", () => {
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        null,
        5,
        "x",
        { id: "ok", type: "core/text", version: 1, props: {} },
      ],
    });
    let issues: ReturnType<typeof validate> = [];
    expect(() => {
      issues = validate(doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
      });
    }).not.toThrow();
    expect(issues.filter(i => i.code === "invalid-node")).toHaveLength(3);
  });

  it("reports a wholly-malformed document instead of dereferencing it", () => {
    for (const bad of [null, undefined, 42, [1, 2, 3]]) {
      let issues: ReturnType<typeof validate> = [];
      expect(() => {
        issues = validate(invalidDoc(bad), {
          breakpoints: FIXTURE_BREAKPOINTS,
          mode: "strict",
        });
      }).not.toThrow();
      expect(issues).toEqual([
        {
          path: "",
          code: "invalid-document",
          severity: "error",
          message: "The document must be an object.",
        },
      ]);
    }
  });

  it("does not throw when a malformed field holds a deeply nested object", () => {
    // formatVersion is rendered into a message; a deep object there must not
    // make the message builder overflow via JSON.stringify.
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 20_000; i++) deep = { nested: deep };
    const doc = invalidDoc({ formatVersion: deep, kind: "page", nodes: [] });
    let issues: ReturnType<typeof validate> = [];
    expect(() => {
      issues = validate(doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
      });
    }).not.toThrow();
    expect(issues.some(i => i.code === "invalid-format-version")).toBe(true);
  });

  it("reports a null binding value instead of throwing", () => {
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          bindings: { text: null },
        },
      ],
    });
    let issues: ReturnType<typeof validate> = [];
    expect(() => {
      issues = validate(doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
      });
    }).not.toThrow();
    expect(
      issues.some(
        i => i.code === "invalid-binding" && i.path === "/nodes/0/bindings/text"
      )
    ).toBe(true);
  });

  it("does not throw on a malformed breakpoint definition", () => {
    const malformedSet = invalidDoc({
      viewport: [{ id: "base", label: "Desktop" }, null],
      container: [],
    }) as unknown as BreakpointSet;
    expect(() => {
      validate(
        { formatVersion: 1, kind: "page", nodes: [] },
        { breakpoints: malformedSet, mode: "strict" }
      );
    }).not.toThrow();
  });

  it("reports a hole inside a slot array as an invalid node", () => {
    const children: unknown[] = [];
    children[1] = { id: "n2", type: "core/text", version: 1, props: {} };
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/section",
          version: 1,
          props: {},
          slots: { children },
        },
      ],
    });
    let issues: ReturnType<typeof validate> = [];
    expect(() => {
      issues = validate(doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
      });
    }).not.toThrow();
    expect(
      issues.some(
        i => i.code === "invalid-node" && i.path === "/nodes/0/slots/children/0"
      )
    ).toBe(true);
  });

  it("reports holes in a sparse nodes array instead of throwing", () => {
    const sparse: unknown[] = [];
    sparse[2] = { id: "n1", type: "core/text", version: 1, props: {} };
    const doc = invalidDoc({ formatVersion: 1, kind: "page", nodes: sparse });
    let issues: ReturnType<typeof validate> = [];
    expect(() => {
      issues = validate(doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
      });
    }).not.toThrow();
    // The two holes are reported as invalid nodes; the real node at index 2 is fine.
    expect(issues.filter(i => i.code === "invalid-node")).toHaveLength(2);
  });

  it("bounds work on an oversized forest instead of exhausting resources", () => {
    // One parent with a very wide child array: with the node cap at 100, the
    // walk and the measurement must both stay bounded and still return the
    // node-count issue rather than processing all 500k children.
    const children = Array.from({ length: 500_000 }, (_, i) => ({
      id: `c${i}`,
      type: "core/text",
      version: 1,
      props: {},
    }));
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "root",
          type: "core/section",
          version: 1,
          props: {},
          slots: { children },
        },
      ],
    });
    const start = Date.now();
    let issues: ReturnType<typeof validate> = [];
    expect(() => {
      issues = validate(doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
        limits: { maxDepth: 12, maxNodes: 100, maxBytes: 1_000_000 },
      });
    }).not.toThrow();
    expect(issues.some(i => i.code === "node-count-exceeded")).toBe(true);
    // Sanity bound: a capped walk finishes fast even though the forest is huge.
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("rejects a huge array in props by byte size without enqueuing it all", () => {
    // A 20M-element array under the node cap: its comma bytes alone exceed the
    // 2MiB cap, so the byte counter must bail before pushing 20M stack entries.
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: { items: new Array(20_000_000).fill(0) },
        },
      ],
    });
    const start = Date.now();
    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      limits: { maxDepth: 12, maxNodes: 5000, maxBytes: 2 * 1024 * 1024 },
    });
    expect(issues.some(i => i.code === "document-too-large")).toBe(true);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("rejects a sparse classes array (holes are not skipped)", () => {
    const classes: unknown[] = [];
    classes[1] = "cls";
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: "core/text", version: 1, props: {}, classes }],
    });
    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
    });
    expect(
      issues.some(
        i => i.code === "invalid-classes" && i.path === "/nodes/0/classes"
      )
    ).toBe(true);
  });

  it("rejects an oversized string prop by byte size without materializing it", () => {
    // A single node well under the node/depth caps but carrying a ~50MB string:
    // the bounded byte counter must reject it quickly, not allocate a full copy.
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: { text: "x".repeat(50_000_000) },
        },
      ],
    });
    const start = Date.now();
    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      limits: { maxDepth: 12, maxNodes: 5000, maxBytes: 2 * 1024 * 1024 },
    });
    expect(issues.some(i => i.code === "document-too-large")).toBe(true);
    // Bounded: aborts near the 2MiB cap rather than walking all 50MB.
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("bounds the size of an untrusted string echoed into a message", () => {
    const huge = "x".repeat(5_000_000);
    const doc = invalidDoc({ formatVersion: huge, kind: "page", nodes: [] });
    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
    });
    const issue = issues.find(i => i.code === "invalid-format-version");
    expect(issue).toBeDefined();
    // The message must not embed the whole 5MB string.
    expect(issue!.message.length).toBeLessThan(300);
  });

  it("does not invoke a malicious toString on an invalid node type", () => {
    const hostileType = {
      toString() {
        throw new Error("boom");
      },
    };
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: hostileType, version: 1, props: {} }],
    });
    let issues: ReturnType<typeof validate> = [];
    expect(() => {
      issues = validate(doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
      });
    }).not.toThrow();
    expect(issues.some(i => i.code === "invalid-node-type")).toBe(true);
  });

  it("rejects a sparse visibility condition array (holes are not skipped)", () => {
    const group: unknown[] = [];
    group[1] = { field: "status", op: "eq" };
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          visibility: { conditions: [group] },
        },
      ],
    });
    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
    });
    expect(
      issues.some(
        i =>
          i.code === "invalid-visibility" &&
          i.path === "/nodes/0/visibility/conditions"
      )
    ).toBe(true);
  });

  it("counts malformed array elements toward the node cap", () => {
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [null, null, null],
    });
    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      limits: { maxDepth: 12, maxNodes: 2, maxBytes: 1_000_000 },
    });
    expect(issues.some(i => i.code === "node-count-exceeded")).toBe(true);
  });
});

describe("engine-owned node types", () => {
  it("does not report a component instance as an unregistered block", () => {
    // A registry holds authored blocks; the component-instance type is the
    // engine's own and would never appear in one.
    const doc: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "nextly/component-instance",
          version: 1,
          props: { componentId: "cmp-1" },
        },
      ],
    };
    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      registry: { has: () => false },
    });
    expect(issues).toEqual([]);
  });
});

describe("dom id collisions", () => {
  it("does not report one node as colliding with itself", () => {
    // cssId and attributes.id on the SAME node render one id, not two.
    const doc: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          cssId: "hero",
          attributes: { id: "hero" },
        },
      ],
    };
    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
    });
    expect(issues.filter(i => i.code === "duplicate-dom-id")).toEqual([]);
  });
});

describe("byte measurement counts JSON escaping", () => {
  it("measures escape-heavy strings at their serialized size", () => {
    // 400 control characters serialize as \uXXXX (6 bytes each ≈ 2400), which
    // must exceed a 1000-byte cap even though the raw string is only 400 chars.
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: { text: "\u0001".repeat(400) },
        },
      ],
    });
    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      limits: { maxDepth: 12, maxNodes: 5000, maxBytes: 1000 },
    });
    expect(issues.some(i => i.code === "document-too-large")).toBe(true);
  });
});

describe("byte estimation agrees with real serialization", () => {
  // Strings that exercise every escape path: short escapes, other control
  // characters, quote/backslash, multi-byte, an emoji (surrogate PAIR), and
  // lone surrogates (which JSON escapes rather than encoding as UTF-8).
  const tricky = [
    "plain ascii",
    "tabs\tand\nnewlines\r\f\b",
    "",
    'quote " and backslash \\',
    "café — ünïcodé",
    "emoji 👋🏽 家",
    `lone high \ud800 and low \udc00`,
  ];

  for (const text of tricky) {
    it(`matches JSON.stringify size for ${JSON.stringify(text).slice(0, 28)}`, () => {
      const doc: BlockDocument = {
        formatVersion: 1,
        kind: "page",
        nodes: [{ id: "n1", type: "core/text", version: 1, props: { text } }],
      };
      // documentBytes serializes for real; the validator's internal estimate
      // must not disagree about which side of the cap the document falls on.
      const actual = documentBytes(doc);
      const underCap = validate(doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
        limits: { maxDepth: 12, maxNodes: 5000, maxBytes: actual + 200 },
      });
      expect(underCap.some(i => i.code === "document-too-large")).toBe(false);

      const overCap = validate(doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
        limits: {
          maxDepth: 12,
          maxNodes: 5000,
          maxBytes: Math.floor(actual / 2),
        },
      });
      expect(overCap.some(i => i.code === "document-too-large")).toBe(true);
    });
  }

  it("does not reject a newline-heavy document that is well under the cap", () => {
    // Newlines serialize as two-byte short escapes, so ~60k of them is ~120KB
    // and must stay far below a 2 MiB cap.
    const doc: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: { text: "\n".repeat(60_000) },
        },
      ],
    };
    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      limits: { maxDepth: 12, maxNodes: 5000, maxBytes: 2 * 1024 * 1024 },
    });
    expect(issues.some(i => i.code === "document-too-large")).toBe(false);
  });
});

describe("unknown kind severity follows the mode", () => {
  it("errors in strict, warns in forgiving", () => {
    const doc = invalidDoc({ formatVersion: 1, kind: "widget", nodes: [] });
    const strict = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
    });
    expect(strict.find(i => i.code === "invalid-kind")?.severity).toBe("error");
    const forgiving = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "forgiving",
    });
    expect(forgiving.find(i => i.code === "invalid-kind")?.severity).toBe(
      "warning"
    );
  });

  it("treats a missing or non-string kind as structural corruption in both modes", () => {
    for (const badKind of [undefined, 5, null]) {
      for (const mode of ["strict", "forgiving"] as const) {
        const issues = validate(
          invalidDoc({ formatVersion: 1, kind: badKind, nodes: [] }),
          { breakpoints: FIXTURE_BREAKPOINTS, mode }
        );
        expect(issues.find(i => i.code === "invalid-kind")?.severity).toBe(
          "error"
        );
      }
    }
  });
});

describe("limits", () => {
  it("flags a document that exceeds the byte cap", () => {
    const big = "x".repeat(2000);
    const nodes = Array.from({ length: 50 }, (_, i) => ({
      id: `n${i}`,
      type: "core/text",
      version: 1,
      props: { text: big },
    }));
    const issues = validate(
      { formatVersion: 1, kind: "page", nodes },
      {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
        limits: { maxDepth: 12, maxNodes: 5000, maxBytes: 1000 },
      }
    );
    expect(issues.some(i => i.code === "document-too-large")).toBe(true);
  });

  it("warns when the document approaches the byte cap", () => {
    const nodes = [
      {
        id: "n1",
        type: "core/text",
        version: 1,
        props: { text: "x".repeat(850) },
      },
    ];
    const issues = validate(
      { formatVersion: 1, kind: "page", nodes },
      {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
        limits: { maxDepth: 12, maxNodes: 5000, maxBytes: 1000 },
      }
    );
    const sizeIssue = issues.find(i => i.code === "document-size-warning");
    expect(sizeIssue?.severity).toBe("warning");
  });

  it("flags too many nodes and too much depth", () => {
    const nodes = Array.from({ length: 6 }, (_, i) => ({
      id: `n${i}`,
      type: "core/text",
      version: 1,
      props: {},
    }));
    const issues = validate(
      { formatVersion: 1, kind: "page", nodes },
      {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
        limits: { maxDepth: 12, maxNodes: 5, maxBytes: 1_000_000 },
      }
    );
    expect(issues.some(i => i.code === "node-count-exceeded")).toBe(true);
  });
});
