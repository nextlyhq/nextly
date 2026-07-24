import { describe, expect, it } from "vitest";

import type { BlockDocument, BreakpointSet } from "./document";
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
