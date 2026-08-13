import { describe, expect, it } from "vitest";

import { DOCUMENT_KINDS } from "./document";
import type { BlockDocument, BlockNode, BreakpointSet } from "./document";
import { DEFAULT_LIMITS, documentBytes } from "./limits";
import {
  MAX_SITE_LOOKUPS,
  MAX_SITE_ISSUES,
  MAX_SITE_ISSUE_PATH_BYTES,
  MAX_STYLE_ISSUES,
} from "./style/validate-style-value";
import {
  FIXTURE_BREAKPOINTS,
  VALIDATION_FIXTURES,
} from "./validation.fixtures";
import type { BlockTypeLookup } from "./validation";
import { ISSUE_CODES, measureBytes, validate } from "./validation";

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

describe("validation leaves the document alone", () => {
  it("does not mangle or drop hostile prop content", () => {
    // The corpus fixture asserts that such a document produces no issues, which
    // is acceptance and not the guarantee that matters: props are opaque to the
    // engine and escaping them belongs to the renderer, so validation must hand
    // back exactly what it was given.
    const doc = invalidDoc({
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
    });
    const before = structuredClone(doc);
    validate(doc, { breakpoints: FIXTURE_BREAKPOINTS, mode: "strict" });
    expect(doc).toEqual(before);
  });
});

describe("validation fixture corpus", () => {
  for (const fixture of VALIDATION_FIXTURES) {
    it(fixture.name, () => {
      // A fixture states which issues a document produces, and that assertion
      // holds just as well if validation rewrote the document on its way
      // through. Reading is the whole contract here — content is opaque bytes
      // to the engine, which is what lets one document serve every writing
      // system — so every fixture is entitled to the check, not only the ones
      // written to be about it.
      const before = structuredClone(fixture.doc);
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
      expect(fixture.doc).toEqual(before);
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
    let node: BlockNode = {
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
    const doc: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [node],
    };
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

  it("checks class ids only against a site that was supplied", () => {
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          classes: ["c_known", "c_missing"],
        },
      ],
    });
    const base = { breakpoints: FIXTURE_BREAKPOINTS, mode: "strict" as const };

    // Without a class library there is nothing to be wrong about: defining a
    // site's first class must not invalidate every document that already
    // lists one.
    expect(validate(doc, base).filter(i => i.code === "unknown-class")).toEqual(
      []
    );

    const withSite = validate(doc, {
      ...base,
      classes: { has: (id: string) => id === "c_known" },
    }).filter(i => i.code === "unknown-class");
    expect(withSite).toHaveLength(1);
    expect(withSite[0]?.path).toBe("/nodes/0/classes/1");
    // Warning even in strict mode: a class the site dropped costs the element
    // that styling, and must not make the document unpublishable.
    expect(withSite[0]?.severity).toBe("warning");
  });

  it("bounds how many unknown class warnings one node can produce", () => {
    // A node may list as many ids as a document has room for, and each unknown
    // one costs a lookup and an allocated issue. Without a bound a small
    // document turns into a very large report.
    const classes = Array.from({ length: 5000 }, (_, i) => `c_missing_${i}`);
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: "core/text", version: 1, props: {}, classes }],
    });
    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      classes: { has: () => false },
    }).filter(i => i.code === "unknown-class");
    // The SITE allowance is what bounds this: `unknown-class` is charged there,
    // not against the structural one. Both default to 200, so naming the wrong
    // constant passes today and stops meaning anything the moment they differ.
    expect(issues.length).toBeLessThanOrEqual(MAX_SITE_ISSUES);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("does not resolve class names on a document past its byte cap", () => {
    // Resolving a name hands the string to a lookup that hashes it, and a known
    // id spends no allowance to stop that. A document already refused for its
    // size would otherwise be read in full, right after the byte cap said not
    // to read it.
    const classes = Array.from({ length: 400 }, (_, i) => "c".repeat(600) + i);
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: Array.from({ length: 20 }, (_, i) => ({
        id: `n${i}`,
        type: "core/text",
        version: 1,
        props: {},
        classes,
      })),
    });
    let asked = 0;
    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      limits: { maxDepth: 12, maxNodes: 5000, maxBytes: 1024 },
      classes: {
        has: () => {
          asked += 1;
          return true;
        },
      },
    });
    expect(issues.some(i => i.code === "document-too-large")).toBe(true);
    expect(asked).toBe(0);
  });

  it("does not resolve class names on a document a limit already refused", () => {
    // The node and depth caps are checked BEFORE the byte pass, and return
    // early, so a flag that only asks about size leaves the expensive per-value
    // work running on a document already known to be invalid.
    const classes = Array.from({ length: 5000 }, (_, i) => `c_${i}`);
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "n1", type: "core/text", version: 1, props: {}, classes },
        { id: "n2", type: "core/text", version: 1, props: {}, classes },
      ],
    });
    let asked = 0;
    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      limits: { maxDepth: 12, maxNodes: 1, maxBytes: 2 * 1024 * 1024 },
      classes: {
        has: () => {
          asked += 1;
          return true;
        },
      },
    });
    expect(issues.some(i => i.code === "node-count-exceeded")).toBe(true);
    expect(asked).toBe(0);
  });

  it("bounds the path text unknown class warnings can return", () => {
    // A JSON Pointer repeats every key above it, so a node under a very long
    // slot key copies that key into every warning reported beneath it. Counting
    // the warnings bounds how many come back without bounding how large they
    // are, and a document inside the byte cap can answer with hundreds of times
    // its own size.
    const slot = "s".repeat(20_000);
    const classes = Array.from({ length: 200 }, (_, i) => `c_missing_${i}`);
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          slots: {
            [slot]: [
              { id: "n2", type: "core/text", version: 1, props: {}, classes },
            ],
          },
        },
      ],
    });
    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      classes: { has: () => false },
    });
    const warnings = issues.filter(i => i.code === "unknown-class");
    const bytes = warnings.reduce((sum, i) => sum + i.path.length, 0);
    // One warning may cross the line rather than being refused at it, so the
    // allowance plus a single longest path is the bound, not the allowance.
    expect(bytes).toBeLessThanOrEqual(MAX_SITE_ISSUE_PATH_BYTES + slot.length);
    expect(warnings.length).toBeGreaterThan(0);
    // Stopping early is said out loud, and said as a warning: what went
    // unreported is which names resolve, which never blocks a publish.
    const marker = issues.filter(i => i.code === "site-issues-truncated");
    expect(marker).toHaveLength(1);
    expect(marker[0]?.severity).toBe("warning");
  });

  it("reports a realistic document the same way with and without a site", () => {
    // End-to-end rather than per-check: one node carrying a good token, a
    // missing token, a token of the wrong kind, a known class and a dropped
    // one. What matters is that supplying the site ADDS warnings and changes
    // nothing else — no error appears, and no issue disappears.
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          classes: ["c_card", "c_gone"],
          styles: {
            base: {
              base: {
                color: { $token: "color.primary" },
                backgroundColor: { $token: "color.missing" },
                gap: { $token: "color.primary" },
                width: "50%",
              },
            },
          },
        },
      ],
    });
    const base = { breakpoints: FIXTURE_BREAKPOINTS, mode: "strict" as const };
    const site = {
      ...base,
      tokens: {
        kindOf: (name: string) =>
          name === "color.primary" ? ("color" as const) : undefined,
      },
      classes: { has: (id: string) => id === "c_card" },
    };

    expect(validate(doc, base)).toEqual([]);

    const issues = validate(doc, site);
    expect(issues.every(issue => issue.severity === "warning")).toBe(true);
    expect(issues.map(issue => `${issue.code} ${issue.path}`).sort()).toEqual([
      "token-kind-mismatch /nodes/0/styles/base/base/gap",
      "unknown-class /nodes/0/classes/1",
      "unknown-token /nodes/0/styles/base/base/backgroundColor",
    ]);
  });

  it("asks the caller's class lookup once per id for the whole document", () => {
    // The same reasoning as the token cache: a KNOWN id produces no issue, so
    // nothing charges it, and a document applying a handful of site classes
    // across thousands of nodes would ask once per occurrence to report nothing.
    const nodes = Array.from({ length: 25 }, (_, index) => ({
      id: `n${index}`,
      type: "core/box",
      version: 1,
      props: {},
      classes: ["c_card", "c_wide"],
    }));
    const asked: string[] = [];
    const issues = validate(
      invalidDoc({ formatVersion: 1, kind: "page", nodes }),
      {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
        classes: {
          has: (id: string) => {
            asked.push(id);
            return true;
          },
        },
      }
    );
    expect(issues).toEqual([]);
    expect(asked.sort()).toEqual(["c_card", "c_wide"]);
  });

  it("stops asking the caller's lookups after the lookup allowance", () => {
    // The two site allowances are charged for what is REPORTED, and a name that
    // RESOLVES is not a finding, so neither of them counts this. Memoizing
    // collapses repeats and cannot collapse distinct names, which leaves the
    // number of calls into caller-supplied code bounded only by the byte cap.
    const distinct = MAX_SITE_LOOKUPS + 500;
    const nodes = Array.from({ length: distinct }, (_, index) => ({
      id: `n${index}`,
      type: "core/box",
      version: 1,
      props: {},
      classes: [`c_${index}`],
    }));
    let asked = 0;
    const issues = validate(
      invalidDoc({ formatVersion: 1, kind: "page", nodes }),
      {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
        limits: { ...DEFAULT_LIMITS, maxNodes: distinct + 10 },
        classes: {
          has: () => {
            asked += 1;
            return true;
          },
        },
      }
    );
    expect(asked).toBeLessThanOrEqual(MAX_SITE_LOOKUPS);
    // And it says so, rather than going quiet: what went unchecked is whether
    // those names resolve, which is exactly what this marker means.
    expect(issues.map(issue => issue.code)).toContain("site-issues-truncated");
  });

  it("still checks a name it has already resolved once lookups are spent", () => {
    // The lookup allowance bounds what the CALLER is asked to do, not what may
    // be reported. A name this run already resolved is answered from its cache
    // for nothing, so refusing it would drop a warning that was free to produce
    // and claim the name went unchecked when it had been checked already.
    const distinct = MAX_SITE_LOOKUPS + 200;
    const nodes = [
      // One node whose class is unknown, seen FIRST so its answer is cached...
      {
        id: "known-early",
        type: "core/box",
        version: 1,
        props: {},
        classes: ["c_missing"],
      },
      // ...then enough distinct ids to spend the lookup allowance...
      ...Array.from({ length: distinct }, (_, index) => ({
        id: `n${index}`,
        type: "core/box",
        version: 1,
        props: {},
        classes: [`c_${index}`],
      })),
      // ...and the same unknown class again, long after it ran out.
      {
        id: "known-late",
        type: "core/box",
        version: 1,
        props: {},
        classes: ["c_missing"],
      },
    ];
    const issues = validate(
      invalidDoc({ formatVersion: 1, kind: "page", nodes }),
      {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
        limits: { ...DEFAULT_LIMITS, maxNodes: distinct + 10 },
        classes: { has: (id: string) => id !== "c_missing" },
      }
    );
    const unknown = issues.filter(issue => issue.code === "unknown-class");
    expect(unknown.map(issue => issue.path)).toEqual([
      "/nodes/0/classes/0",
      `/nodes/${distinct + 1}/classes/0`,
    ]);
  });

  it("asks the caller's token lookup once per name for the whole document", () => {
    // The cache belongs to the walk, not to one style envelope. Built per
    // envelope it would reset at every node, state and breakpoint, so a site
    // token repeated across a large document would be resolved once per
    // occurrence. Nothing else bounds that: a name that RESOLVES produces no
    // issue, so it never charges the allowance that stops the rest of the work.
    const nodes = Array.from({ length: 25 }, (_, index) => ({
      id: `n${index}`,
      type: "core/box",
      version: 1,
      props: {},
      styles: {
        base: { base: { color: { $token: "color.primary" } } },
        hover: { base: { color: { $token: "color.primary" } } },
      },
    }));
    const asked: string[] = [];
    const issues = validate(
      invalidDoc({ formatVersion: 1, kind: "page", nodes }),
      {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
        tokens: {
          kindOf: (name: string) => {
            asked.push(name);
            return "color" as const;
          },
        },
      }
    );
    // A resolving token is not a finding, so the document is clean and every
    // one of the 50 envelopes was really walked.
    expect(issues).toEqual([]);
    expect(asked).toEqual(["color.primary"]);
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

describe("the document-kind vocabulary", () => {
  it("is the frozen set the corpus is built from", () => {
    // The kind fixtures are derived from this list, so an addition arrives with
    // coverage. A removal would take its fixture with it and leave every test
    // passing, which is what this pins: changing the vocabulary has to be
    // deliberate enough to change it here too.
    expect([...DOCUMENT_KINDS]).toEqual([
      "page",
      "pattern",
      "component",
      "region",
      "template",
    ]);
  });

  it("has a corpus fixture for every kind in it", () => {
    for (const kind of DOCUMENT_KINDS) {
      expect(
        VALIDATION_FIXTURES.some(
          f => f.doc.kind === kind && f.mode === "strict"
        ),
        `no fixture validates a ${kind} document`
      ).toBe(true);
    }
  });
});

describe("a malformed style envelope charges the budget like anything else", () => {
  it("bounds a document whose breakpoints each hold a non-object", () => {
    // A cap is only as tight as the fraction of issue kinds that remember to
    // pay it: an uncharged push lets the walk run past the limit by however
    // many of those it emits.
    const byBreakpoint: Record<string, unknown> = {};
    for (let index = 0; index < 5000; index += 1) {
      byBreakpoint[`bp${index}`] = "not an object";
    }
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          styles: { base: byBreakpoint },
        },
      ],
    });
    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
    });
    expect(issues.length).toBeLessThan(300);
    expect(issues.some(issue => issue.code === "style-issues-truncated")).toBe(
      true
    );
  });
});

describe("style keys inherited from a prototype", () => {
  function docWithRawStyles(styles: unknown): BlockDocument {
    return invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: "core/box", version: 1, props: {}, styles }],
    });
  }

  function codesFor(styles: unknown): string[] {
    return validate(docWithRawStyles(styles), {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
    }).map(issue => issue.code);
  }

  it("are refused along with the object carrying them", () => {
    // A document is JSON, and this object is not a JSON value: what would be
    // stored is the own keys alone. Saying so is better than validating the
    // own keys and dropping the rest in silence.
    const styles = Object.create({
      hover: { base: { nope: "1px" } },
    }) as Record<string, unknown>;
    styles.base = { base: { display: "block" } };
    expect(codesFor(styles)).toEqual(["invalid-style-values"]);
  });

  it("are refused at the breakpoint level too", () => {
    // The inherited key has to differ from the own one, or it is shadowed and
    // never enumerated separately, which would prove nothing.
    const byBreakpoint = Object.create({
      tablet: { nope: "1px" },
    }) as Record<string, unknown>;
    byBreakpoint.base = { display: "block" };
    expect(codesFor({ base: byBreakpoint })).toEqual(["invalid-style-values"]);
  });

  it("are not read off a polluted Object.prototype", () => {
    // The threat a plain object cannot be refused out of: every object built
    // from JSON inherits from Object.prototype, so polluting it would make
    // every document appear to declare a state it never stored. The own-key
    // walk is what holds here, not the shape check.
    const polluted = Object.prototype as unknown as Record<string, unknown>;
    polluted.hover = { base: { nope: "1px" } };
    try {
      expect(codesFor({ base: { base: { display: "block" } } })).toEqual([]);
    } finally {
      delete polluted.hover;
    }
  });
});

describe("unresolved names never block a publish", () => {
  it("keeps checking structure after a renamed token is used everywhere", () => {
    // The scenario is a commonly used token being renamed: every document that
    // referenced it now warns at every use. Those warnings are documented as
    // never blocking a publish, but the marker for stopping early is an ERROR,
    // so letting them spend the structural allowance would block one anyway —
    // on a document whose structure nothing objects to.
    const nodes: unknown[] = Array.from(
      { length: MAX_SITE_ISSUES + 60 },
      (_, index) => ({
        id: `n${index}`,
        type: "core/box",
        version: 1,
        props: {},
        styles: { base: { base: { color: { $token: "brand.renamed" } } } },
      })
    );
    // Last, so that reaching it proves the walk was not cut short.
    nodes.push({
      id: "last",
      type: "core/box",
      version: 1,
      props: {},
      styles: { base: { base: { color: 42 } } },
    });
    const issues = validate(
      invalidDoc({ formatVersion: 1, kind: "page", nodes }),
      {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
        tokens: { kindOf: () => undefined },
      }
    );
    expect(issues.some(i => i.code === "style-issues-truncated")).toBe(false);
    expect(
      issues.some(
        i =>
          i.code === "invalid-style-value" &&
          i.path === `/nodes/${nodes.length - 1}/styles/base/base/color`
      )
    ).toBe(true);
    // The warnings are still bounded, and still only warnings.
    const unresolved = issues.filter(i => i.code === "unknown-token");
    expect(unresolved.length).toBeLessThanOrEqual(MAX_SITE_ISSUES);
    expect(unresolved.every(i => i.severity === "warning")).toBe(true);
    expect(issues.filter(i => i.code === "site-issues-truncated")).toHaveLength(
      1
    );
  });
});

describe("a malformed styles field is charged to the budget", () => {
  it("bounds a document where every node has a non-object styles", () => {
    // One issue per node is bounded only by the node count, and the cap is
    // document-wide; without charging it a large forest reports thousands of
    // style issues and never says it stopped.
    const nodes = Array.from({ length: 500 }, (_, index) => ({
      id: `n${index}`,
      type: "core/box",
      version: 1,
      props: {},
      styles: "not an object",
    }));
    const issues = validate(
      invalidDoc({ formatVersion: 1, kind: "page", nodes }),
      {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
      }
    );
    expect(issues.length).toBeLessThan(300);
    expect(issues.some(issue => issue.code === "style-issues-truncated")).toBe(
      true
    );
  });
});

describe("two chargeable findings on one breakpoint", () => {
  it("does not let the second push past the cap", () => {
    // Every breakpoint here is both unknown AND holds a non-object, so each
    // iteration charges twice. The unknown state ahead of them is what makes
    // the remaining budget ODD: charging two at a time from an even cap lands
    // exactly on zero at an iteration boundary and never overruns, so without
    // it this would pass whether the check between them exists or not.
    const byBreakpoint: Record<string, unknown> = {};
    for (let index = 0; index < 400; index += 1) {
      byBreakpoint[`bp${index}`] = "not an object";
    }
    const issues = validate(
      invalidDoc({
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "n1",
            type: "core/box",
            version: 1,
            props: {},
            styles: { nope: { base: {} }, base: byBreakpoint },
          },
        ],
      }),
      { breakpoints: FIXTURE_BREAKPOINTS, mode: "strict" }
    );
    const styleIssues = issues.filter(
      issue => issue.code !== "style-issues-truncated"
    );
    expect(styleIssues.length).toBeLessThanOrEqual(MAX_STYLE_ISSUES);
    expect(issues.some(issue => issue.code === "style-issues-truncated")).toBe(
      true
    );
  });
});

describe("the truncation marker means work was actually skipped", () => {
  function docWithBreakpoints(count: number, values: unknown): BlockDocument {
    const byBreakpoint: Record<string, unknown> = {};
    for (let index = 0; index < count; index += 1) {
      byBreakpoint[`bp${index}`] = values;
    }
    return invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          styles: { base: byBreakpoint },
        },
      ],
    });
  }

  it("is absent when the last slot went on a breakpoint holding nothing", () => {
    // The marker is an ERROR, so claiming a document went unchecked when every
    // value was read rejects it for having been fully validated.
    const issues = validate(docWithBreakpoints(MAX_STYLE_ISSUES, {}), {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "forgiving",
    });
    expect(issues).toHaveLength(MAX_STYLE_ISSUES);
    expect(issues.filter(issue => issue.severity === "error")).toEqual([]);
  });

  it("is still emitted when values really do remain unread", () => {
    const issues = validate(docWithBreakpoints(400, { color: "#fff" }), {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "forgiving",
    });
    expect(issues.some(issue => issue.code === "style-issues-truncated")).toBe(
      true
    );
  });

  it("is emitted when the last slot goes on the LAST breakpoint, if it holds values", () => {
    // Exactly one breakpoint per slot, so the budget runs out on the final
    // entry and there is no next iteration to notice. Its values go unread, so
    // the marker is owed even though nothing follows.
    const issues = validate(
      docWithBreakpoints(MAX_STYLE_ISSUES, { color: "#fff" }),
      { breakpoints: FIXTURE_BREAKPOINTS, mode: "forgiving" }
    );
    expect(issues.some(issue => issue.code === "style-issues-truncated")).toBe(
      true
    );
  });
});

describe("an empty breakpoint reached after the budget ran out", () => {
  it("does not claim the document went unchecked", () => {
    // The exemption belongs at both checks: this entry is reached at the top
    // of the loop rather than after a charge, and skipping it costs nothing
    // either way because it holds no values.
    const byBreakpoint: Record<string, unknown> = {};
    for (let index = 0; index < MAX_STYLE_ISSUES; index += 1) {
      byBreakpoint[`bp${index}`] = {};
    }
    byBreakpoint.base = {};
    const issues = validate(
      invalidDoc({
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "n1",
            type: "core/box",
            version: 1,
            props: {},
            styles: { base: byBreakpoint },
          },
        ],
      }),
      { breakpoints: FIXTURE_BREAKPOINTS, mode: "forgiving" }
    );
    expect(issues.filter(issue => issue.severity === "error")).toEqual([]);
  });
});

describe("what the budget stops, and what it lets through", () => {
  function docWithStyles(styles: unknown): BlockDocument {
    return invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: "core/box", version: 1, props: {}, styles }],
    });
  }

  it("does not truncate a later state whose breakpoints hold nothing", () => {
    const byBreakpoint: Record<string, unknown> = {};
    for (let index = 0; index < MAX_STYLE_ISSUES; index += 1) {
      byBreakpoint[`x${index}`] = {};
    }
    const issues = validate(
      docWithStyles({ base: byBreakpoint, hover: { base: {} } }),
      { breakpoints: FIXTURE_BREAKPOINTS, mode: "forgiving" }
    );
    expect(issues.filter(issue => issue.severity === "error")).toEqual([]);
  });

  it("still caps unknown breakpoints, whose warning is itself an issue", () => {
    // An empty map means no VALUES to check, but an unknown id still reports
    // itself, so exempting these would let the walk emit past the cap.
    const byBreakpoint: Record<string, unknown> = {};
    for (let index = 0; index < 500; index += 1) {
      byBreakpoint[`y${index}`] = {};
    }
    const issues = validate(docWithStyles({ base: byBreakpoint }), {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "forgiving",
    });
    expect(issues.length).toBeLessThan(300);
    expect(issues.some(issue => issue.code === "style-issues-truncated")).toBe(
      true
    );
  });
});

describe("a document past the byte cap stops paying to read its values", () => {
  function styledNodes(count: number, terms: number): BlockNode[] {
    return Array.from({ length: count }, (_, index) => ({
      id: `n${index}`,
      type: "core/box",
      version: 1,
      props: {},
      styles: {
        base: {
          base: {
            fontFamily: Array.from({ length: terms }, (_, t) => `f${t}`).join(
              ", "
            ),
          },
        },
      },
    }));
  }

  it("reports the size and stops parsing every value", () => {
    // The document is rejected whatever those values say, and parsing each one
    // builds an AST apiece, so the byte cap would otherwise bound the document
    // without bounding the work spent reading it.
    const issues = validate(
      invalidDoc({
        formatVersion: 1,
        kind: "page",
        nodes: styledNodes(1200, 700),
      }),
      { breakpoints: FIXTURE_BREAKPOINTS, mode: "strict" }
    );
    expect(issues.some(issue => issue.code === "document-too-large")).toBe(
      true
    );
  });

  it("does not report on values it declined to read", () => {
    // The trade this makes: a document past the cap is told it is too large
    // and not also told what its values say, because reading them is the cost
    // being avoided and the document is rejected either way.
    const nodes = styledNodes(1200, 700);
    const first = nodes[0];
    if (first !== undefined) {
      first.styles = { base: { base: { width: "red" } } };
    }
    const issues = validate(
      invalidDoc({ formatVersion: 1, kind: "page", nodes }),
      { breakpoints: FIXTURE_BREAKPOINTS, mode: "strict" }
    );
    expect(issues.some(issue => issue.code === "document-too-large")).toBe(
      true
    );
    expect(issues.map(issue => issue.code)).not.toContain(
      "invalid-style-value"
    );
  });

  it("still reads every value in a document within the cap", () => {
    const issues = validate(
      invalidDoc({
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "n1",
            type: "core/box",
            version: 1,
            props: {},
            styles: { base: { base: { width: "red" } } },
          },
        ],
      }),
      { breakpoints: FIXTURE_BREAKPOINTS, mode: "strict" }
    );
    expect(issues.map(issue => issue.code)).toContain("invalid-style-value");
  });
});

describe("measureBytes", () => {
  // The counter decides whether a document is too large, and `validate()` and
  // the builder's op store both ask it. So the property that matters is not
  // "close enough" but that it agrees with what will actually be written: a
  // counter that reads low lets a document past a cap it exceeds, and nothing
  // downstream re-checks.
  //
  // Pinned against `JSON.stringify` rather than against remembered numbers,
  // because the numbers are what drift. Object separators were missing here:
  // every object with more than one property counted one byte short per extra
  // property, which compounds with nesting.
  it.each([
    ["one property", { a: 1 }],
    ["two properties", { a: 1, b: 2 }],
    ["three properties", { a: 1, b: 2, c: 3 }],
    ["nested objects", { a: { x: 1, y: 2 }, b: { x: 1, y: 2 } }],
    ["an array", [1, 2, 3]],
    ["an empty object", {}],
    ["an empty array", []],
    ["a string", { s: "hello" }],
    ["a multibyte string", { s: "héllo wörld ✓" }],
    ["null and booleans", { a: null, b: true, c: false }],
    [
      "a document",
      {
        formatVersion: 1,
        kind: "page",
        nodes: [{ id: "a", type: "box", version: 1, props: { text: "hi" } }],
      },
    ],
    // The members `JSON.stringify` DROPS. An update that clears a field leaves
    // an own property holding `undefined`, so charging for one measures a
    // document larger than the one that gets saved — and an edit that shrinks
    // a document then reads as growing it.
    ["an undefined member", { a: 1, b: undefined }],
    ["only undefined members", { a: undefined }],
    ["a function member", { a: 1, b: () => 1 }],
    ["a symbol member", { a: 1, b: Symbol("s") }],
    ["nested dropped members", { a: { b: undefined, c: 2 } }],
    // In an ARRAY the same values become `null`, because length is part of an
    // array's meaning.
    ["an undefined element", [1, undefined, 3]],
    // `JSON.stringify` writes `null` for a number it cannot represent, so the
    // count must follow the written form rather than the source spelling.
    ["NaN", { n: NaN }],
    ["Infinity", { n: Infinity }],
    ["negative Infinity", { n: -Infinity }],
    ["a function element", [1, () => 1, 3]],
  ])("counts %s exactly as it serializes", (_label, value) => {
    expect(measureBytes(value, Number.POSITIVE_INFINITY).bytes).toBe(
      Buffer.byteLength(JSON.stringify(value), "utf8")
    );
  });

  it("stops once the limit is passed rather than counting the whole value", () => {
    // The bail-out is the reason this counter exists rather than
    // `documentBytes`: an oversized value must be refused without being
    // materialized. A counter that reported `exceeded` only after walking
    // everything would answer correctly and still allocate the walk.
    const wide = { huge: "x".repeat(5_000_000) };
    const result = measureBytes(wide, 100);
    expect(result.exceeded).toBe(true);
    expect(
      result.bytes,
      "a bounded count stops near the limit rather than at the true size"
    ).toBeLessThan(5_000_000);
  });
});

describe("measureBytes and the serializer agree on toJSON", () => {
  it("counts what JSON.stringify writes for a value defining toJSON", () => {
    // A `Date` carries no enumerable fields, so a walk over its properties
    // counts an empty object while the writer emits a quoted timestamp. Pinned
    // against `Buffer.byteLength(JSON.stringify(v))` rather than a remembered
    // number, so the next divergence fails instead of needing to be noticed.
    const value = { when: new Date("2020-01-01T00:00:00.000Z") };
    const written = Buffer.byteLength(JSON.stringify(value), "utf8");

    expect(measureBytes(value, 1_000).bytes).toBe(written);
    expect(measureBytes(value, 20).exceeded).toBe(true);
  });
});

describe("measureBytes passes toJSON the key the serializer does", () => {
  it("matches the writer for a key-sensitive hook", () => {
    // `JSON.stringify` calls `toJSON(key)` with the containing property name.
    // Called with no argument, a hook that reads the key either throws or
    // returns something else, and the counter stops agreeing with the writer.
    const value = {
      child: {
        toJSON(key: string) {
          return key.repeat(3);
        },
      },
      list: [
        {
          toJSON(key: string) {
            return `at-${key}`;
          },
        },
      ],
    };
    const written = Buffer.byteLength(JSON.stringify(value), "utf8");

    expect(measureBytes(value, 1_000).bytes).toBe(written);
  });
});

describe("measureBytes drops what the serializer drops", () => {
  it("charges nothing for a member whose toJSON returns undefined", () => {
    // The hook runs BEFORE the writer decides whether the member is writable,
    // so this object serializes to `{}`. Filtering on the member as it stands
    // keeps it and charges key, quotes, colon and value.
    const value = { x: { toJSON: () => undefined } };
    const written = Buffer.byteLength(JSON.stringify(value), "utf8");

    expect(measureBytes(value, 1_000).bytes).toBe(written);
  });

  it("writes null for an array element whose toJSON returns a function", () => {
    // An array's length is part of its meaning, so a value the writer cannot
    // represent becomes `null` rather than disappearing.
    const value = { list: [1, { toJSON: () => () => 1 }, 3] };
    const written = Buffer.byteLength(JSON.stringify(value), "utf8");

    expect(measureBytes(value, 1_000).bytes).toBe(written);
  });
});

describe("measureBytes agrees with the serializer on hooks and cycles", () => {
  it("refuses a cyclic value in exact-count mode instead of hanging", () => {
    // With no cap, nothing is ever over the limit, so the early return that
    // stops the walk in capped mode never fires and each visit queues the same
    // object again. `JSON.stringify` rejects this immediately.
    const value: Record<string, unknown> = { a: 1 };
    value.self = value;

    // Reported, not thrown: callers include validators that must turn an
    // unstorable document into an issue rather than raise. Under a finite limit
    // this was already the answer, because each revisit added bytes until the
    // cap stopped the walk; the cycle set is what makes the exact-count mode
    // reach it instead of never terminating.
    expect(measureBytes(value, Number.POSITIVE_INFINITY)).toEqual({
      bytes: expect.any(Number) as number,
      exceeded: true,
      reason: "unwritable",
    });
  });

  it("runs a nested toJSON once, as the writer does", () => {
    // `JSON.stringify` writes what the hook returns AS-IS; it does not call
    // `toJSON` again on the replacement. Normalising twice measures a value the
    // writer never produces.
    const value = { x: { toJSON: () => ({ toJSON: () => "0123456789" }) } };
    const written = Buffer.byteLength(JSON.stringify(value), "utf8");

    expect(measureBytes(value, 1_000).bytes).toBe(written);
  });

  it("still counts a value that appears twice as siblings", () => {
    // Two references to one object is a tree, not a cycle, and JSON writes it
    // fine — so the cycle guard must not refuse it.
    const shared = { a: 1 };
    const value = { left: shared, right: shared };
    const written = Buffer.byteLength(JSON.stringify(value), "utf8");

    expect(measureBytes(value, 1_000).bytes).toBe(written);
  });
});

describe("measureBytes says WHY a value cannot be stored", () => {
  it("calls a BigInt unwritable rather than counting it", () => {
    // `JSON.stringify` THROWS on a BigInt — it neither writes nor drops it — so
    // counting it as an ordinary value reports a document as fitting that the
    // writer refuses entirely.
    expect(measureBytes({ x: 1n }, 100)).toEqual({
      bytes: expect.any(Number) as number,
      exceeded: true,
      reason: "unwritable",
    });
  });

  it("calls a boxed BigInt unwritable too", () => {
    // `Object(1n)` is a BigInt OBJECT, so `typeof` reports "object" and the
    // walk would treat it as an ordinary record with no own keys.
    expect(measureBytes({ x: Object(1n) }, 100)).toEqual({
      bytes: expect.any(Number) as number,
      exceeded: true,
      reason: "unwritable",
    });
  });

  it("reports whichever refusal the bounded walk reaches first", () => {
    // A document can be BOTH unwritable and over the limit, and one `reason`
    // can only carry one of them. Which one surfaces is decided by traversal:
    // the walk returns at the FIRST refusal it reaches and never looks further,
    // because establishing that no unwritable value exists anywhere would mean
    // reading the whole document — exactly the unbounded pass this counter
    // exists to avoid.
    //
    // The traversal is a LIFO stack, so an object's LAST entry is visited
    // first. That makes the answer depend on declaration order, which is
    // pinned here as the measured behaviour rather than defended as a policy:
    // nothing outside this walk can predict it, so no caller may rely on which
    // reason arrives for a document that is both.
    const reached = measureBytes({ pad: "x".repeat(500), bad: 1n }, 100);
    const notReached = measureBytes({ bad: 1n, pad: "x".repeat(500) }, 100);

    expect(reached.exceeded && reached.reason).toBe("unwritable");
    expect(notReached.exceeded && notReached.reason).toBe("over-limit");

    // What a caller MAY rely on, and the reason both spellings are safe to
    // reject on: either way the document is refused.
    expect([reached.exceeded, notReached.exceeded]).toEqual([true, true]);
  });

  it("writes an object that only CLAIMS to be a BigInt", () => {
    // `Symbol.toStringTag` is an ordinary writable property of the document
    // under inspection, so `Object.prototype.toString` reports whatever the
    // document says. This value tags itself `[object BigInt]` and the writer
    // stores it regardless, which is why the refusal is decided by the internal
    // slot instead: classifying by the tag would let block props declare
    // themselves unstorable and lock their own author out.
    const spoof = { [Symbol.toStringTag]: "BigInt", x: 1 };
    const written = JSON.stringify({ v: spoof });

    // The positive control for the pair: the writer really does store one and
    // really does refuse the other, so the two cases are genuinely different
    // rather than both being accepted.
    expect(written).toBe('{"v":{"x":1}}');
    expect(() => JSON.stringify({ v: Object(1n) })).toThrow(TypeError);

    expect(measureBytes({ v: spoof }, 1_000)).toEqual({
      bytes: Buffer.byteLength(written, "utf8"),
      exceeded: false,
    });
  });

  it("still says over-limit when the document is merely too big", () => {
    // The distinction is the whole point: these two need opposite advice, and
    // a single boolean cannot tell an author which one they have.
    const measured = measureBytes({ x: "y".repeat(500) }, 100);

    expect(measured).toEqual({
      bytes: expect.any(Number) as number,
      exceeded: true,
      reason: "over-limit",
    });
  });
});

describe("measureBytes stays cheap on ordinary objects", () => {
  it("does not throw once per record while looking for boxed BigInts", () => {
    // The unspoofable brand check costs a thrown exception for every value that
    // is not a BigInt, so running it on every record would pay that across the
    // whole document. `props` is not covered by the node cap, so an ordinary
    // request can carry hundreds of thousands of small objects.
    //
    // Asserted as a RATIO against the same walk over primitives rather than as
    // a wall-clock bound, because an absolute millisecond figure measures the
    // machine. A throw per record is a ~100x cost and shows up either way.
    const records = Array.from({ length: 20_000 }, () => ({}));
    const numbers = Array.from({ length: 20_000 }, () => 0);

    const startRecords = performance.now();
    measureBytes({ v: records }, Number.POSITIVE_INFINITY);
    const recordsMs = performance.now() - startRecords;

    const startNumbers = performance.now();
    measureBytes({ v: numbers }, Number.POSITIVE_INFINITY);
    const numbersMs = performance.now() - startNumbers;

    expect(
      recordsMs / Math.max(numbersMs, 0.01),
      `walking ${String(records.length)} records took ${recordsMs.toFixed(1)}ms ` +
        `against ${numbersMs.toFixed(1)}ms for the same count of numbers`
    ).toBeLessThan(20);
  });

  it("still refuses a boxed BigInt and still writes a tag that only claims to be one", () => {
    // The positive control for the pre-filter: it must not have bought its
    // speed by giving up either answer.
    expect(measureBytes({ x: Object(1n) }, 100).exceeded).toBe(true);
    expect(
      measureBytes({ v: { [Symbol.toStringTag]: "BigInt", x: 1 } }, 1_000)
        .exceeded
    ).toBe(false);
  });
});
