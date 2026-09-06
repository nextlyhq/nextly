import { describe, expect, it } from "vitest";

import {
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
  MAX_BREAKPOINT_ID_LENGTH,
} from "./document";
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
import type { NestingSource } from "./nesting";
import type { BlockTypeLookup } from "./validation";
import { compilePageCss } from "./style/compile-page";
import { measureBytes } from "./measure-bytes";
import { ISSUE_CODES, validate, validateDocument } from "./validation";

function lookup(types: string[]): BlockTypeLookup {
  const set = new Set(types);
  return { has: type => set.has(type) };
}

/** Coerce deliberately-malformed input to BlockDocument for the validator. */
function invalidDoc(doc: unknown): BlockDocument {
  return doc as BlockDocument;
}

/**
 * A nesting source answering from a literal map of declared parents.
 *
 * A type the map does not name answers undefined, which the rule reads as "no
 * restriction" — the same answer the registry source gives for a block it does
 * not hold.
 */
function nestingOf(parents: Record<string, readonly string[]>): NestingSource {
  return { parentsOf: type => parents[type] };
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
  it("reports a node sitting in a container its definition forbids", () => {
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "row",
          type: "core/container",
          version: 1,
          props: {},
          slots: {
            default: [
              { id: "cell", type: "acme/column", version: 1, props: {} },
            ],
          },
        },
      ],
    });

    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      nesting: nestingOf({ "acme/column": ["core/columns"] }),
    });

    const placement = issues.find(i => i.code === "wrong-parent");
    expect(placement?.path).toBe("/nodes/0/slots/default/0");
    expect(placement?.severity).toBe("error");
    // Names where the block WILL go, because that is the author's next action.
    expect(placement?.message).toContain("core/columns");
  });

  it("reports a restricted node at the TOP LEVEL, where it has no container", () => {
    // The walk only ever sees a node as somebody's child, so without the root
    // entries carrying "no parent" the one node with no container is the one
    // node the rule never reaches.
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "cell", type: "acme/column", version: 1, props: {} }],
    });

    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      nesting: nestingOf({ "acme/column": ["core/columns"] }),
    });

    const placement = issues.find(i => i.code === "restricted-at-root");
    expect(placement?.path).toBe("/nodes/0");
    expect(placement?.severity).toBe("error");
  });

  it("accepts a node in a container its definition permits", () => {
    // The positive control. Every refusal above is also satisfied by a rule that
    // refuses everything, and at each individual assertion the two look alike.
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "row",
          type: "core/columns",
          version: 1,
          props: {},
          slots: {
            default: [
              { id: "cell", type: "acme/column", version: 1, props: {} },
            ],
          },
        },
      ],
    });

    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      nesting: nestingOf({ "acme/column": ["core/columns"] }),
    });

    expect(issues.some(i => i.code === "wrong-parent")).toBe(false);
    expect(issues.some(i => i.code === "restricted-at-root")).toBe(false);
  });

  it("is an ERROR in forgiving mode too", () => {
    // `parent` is the child stating where it is meaningful, so a violation is a
    // document that renders somewhere its author never said it could — not a
    // forward-compatible value the lenient mode exists to preserve.
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "cell", type: "acme/column", version: 1, props: {} }],
    });

    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "forgiving",
      nesting: nestingOf({ "acme/column": ["core/columns"] }),
    });

    expect(issues.find(i => i.code === "restricted-at-root")?.severity).toBe(
      "error"
    );
  });

  it("does not check placement when the caller supplies no nesting source", () => {
    // Absent means not checked, the same terms as tokens and classes. Asserted
    // so the fail-open is a decision the suite records rather than a gap.
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "cell", type: "acme/column", version: 1, props: {} }],
    });

    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
    });

    expect(issues.some(i => i.code === "restricted-at-root")).toBe(false);
  });

  it("asks the rule about a container the document actually names", () => {
    // The parent handed to the rule is the CONTAINER's type, not the slot name
    // and not the child's own. A walk that carried the wrong one would refuse
    // and accept in the right proportions while answering a different question,
    // so the observation is on what the source was ASKED rather than on the
    // verdict it produced.
    const asked: string[] = [];
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "row",
          type: "core/columns",
          version: 1,
          props: {},
          slots: {
            default: [
              { id: "cell", type: "acme/column", version: 1, props: {} },
            ],
          },
        },
      ],
    });

    validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      nesting: {
        parentsOf: type => {
          asked.push(type);
          return type === "acme/column" ? ["core/columns"] : undefined;
        },
      },
    });

    // Both nodes reach the rule: the container as a root, the child under it.
    expect(asked).toContain("core/columns");
    expect(asked).toContain("acme/column");
  });

  it("explains a refusal from the restriction that produced it", () => {
    // `NestingSource` is caller-supplied and nothing requires it to be
    // idempotent. A source answering differently on a second call is what
    // separates a message DERIVED from the verdict from one that re-asks: both
    // name a permitted set, and only one names the set that actually refused
    // this placement.
    let call = 0;
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "cell", type: "acme/column", version: 1, props: {} }],
    });

    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      nesting: {
        parentsOf: () => {
          call += 1;
          return call === 1 ? ["core/columns"] : ["acme/somewhere-else"];
        },
      },
    });

    const placement = issues.find(i => i.code === "restricted-at-root");
    expect(placement?.message).toContain("core/columns");
    expect(placement?.message).not.toContain("acme/somewhere-else");
  });

  it.each(["columns", "core/columns/", "", "core//columns"])(
    "declines the placement question under a container typed %o",
    badType => {
      // A STRING is not a name. These are all strings no block can be named, so
      // treating them as container names refuses a restricted child against
      // something nothing could ever match — a placement error the author cannot
      // act on, beside the malformed-type error that is the real defect.
      const doc = invalidDoc({
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "row",
            type: badType,
            version: 1,
            props: {},
            slots: {
              default: [
                { id: "cell", type: "acme/column", version: 1, props: {} },
              ],
            },
          },
        ],
      });

      const issues = validate(doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
        nesting: nestingOf({ "acme/column": ["core/columns"] }),
      });

      expect(
        issues.filter(
          i => i.code === "wrong-parent" || i.code === "restricted-at-root"
        )
      ).toEqual([]);
      // The container's own defect is still what the document is refused for.
      expect(issues.some(i => i.code === "invalid-node-type")).toBe(true);
    }
  );

  it("does not call a child of an unnameable container a root", () => {
    // "No container" and "a container this walk cannot name" are different
    // facts. One absent value standing for both makes a node in a slot answer
    // the ROOT question, which reports it as sitting nowhere while its own path
    // names the slot holding it — a refusal that contradicts itself and that an
    // author cannot act on, because the placement it describes is not the one
    // the node is in.
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "bad",
          type: 42,
          version: 1,
          props: {},
          slots: {
            default: [
              { id: "cell", type: "acme/column", version: 1, props: {} },
            ],
          },
        },
      ],
    });

    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      nesting: nestingOf({ "acme/column": ["core/columns"] }),
    });

    expect(
      issues.filter(
        i => i.code === "restricted-at-root" || i.code === "wrong-parent"
      )
    ).toEqual([]);
    // The container's own defect is still reported, so declining the placement
    // question leaves the document refused rather than silently accepted.
    expect(
      issues.some(
        i => i.code === "invalid-node-type" && i.path === "/nodes/0/type"
      )
    ).toBe(true);
  });

  it("does not ask about placement when the node type is malformed", () => {
    // A malformed type is already reported as an invalid node. Asking where it
    // may sit would answer for a name no definition carries, and add a second
    // complaint about the same defect in terms the author cannot act on.
    const asked: string[] = [];
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "bad", type: 42, version: 1, props: {} }],
    });

    validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      nesting: {
        parentsOf: type => {
          asked.push(type);
          return undefined;
        },
      },
    });

    expect(asked).toEqual([]);
  });

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
        // The byte cap is deliberately far out of reach. This test is about the
        // NODE cap bounding the walk, and a forest of 500,000 children also
        // outruns a 1 MB budget — so a byte limit near the document's real size
        // decides the outcome before the node cap is consulted, and the
        // assertion below would be reporting on a bound the test does not name.
        limits: { maxDepth: 12, maxNodes: 100, maxBytes: 100_000_000 },
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

  it("enforces the node cap the survey measured, not a later answer", () => {
    // A limit that GROWS between reads. Nothing obliges a caller to hand over a
    // plain object, and an accessor is free to answer differently every time —
    // so a bound read once for the verdict and again to size the walk is two
    // different bounds, and the second one is the one that decides how much
    // work a hostile document gets.
    //
    // The walk must be sized by the number the verdict was computed from. The
    // observable form of that is the read COUNT: one read per limit, at the
    // point the survey snapshots them. Asserting only that the issue is
    // reported passes on the broken implementation too, because the verdict was
    // always right — it was the traversal after it that ran unbounded.
    let reads = 0;
    const nodes = Array.from({ length: 200 }, (_, i) => ({
      id: `n${i}`,
      type: "core/text",
      version: 1,
      props: {},
    }));
    const doc = invalidDoc({ formatVersion: 1, kind: "page", nodes });
    const limits = {
      maxDepth: 12,
      maxBytes: 2 * 1024 * 1024,
      get maxNodes() {
        reads += 1;
        return reads === 1 ? 10 : 1_000_000_000;
      },
    };

    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      limits,
    });

    expect(issues.some(i => i.code === "node-count-exceeded")).toBe(true);
    // Exactly one, and the message must quote the bound that was ENFORCED
    // rather than whichever value a later read produced.
    expect(reads).toBe(1);
    // The WHOLE message, not a substring of it. `includes("10")` is satisfied
    // by "100" and by the getter's own 1000000000, so it passes on exactly the
    // implementation this asserts against.
    expect(
      issues.filter(i => i.code === "node-count-exceeded").map(i => i.message)
    ).toEqual(["Document exceeds the maximum of 10 nodes."]);
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
    // TWO issues now, and both are true. `invalid-style-values` names the
    // specific defect; `document-lossy` is the document-level statement that
    // what would be stored is not what was validated. Lossy rather than
    // unwritable, and the distinction is the point: JSON WRITES this document,
    // dropping the inherited keys, so it has a stored form and that form is not
    // this object. Calling it unwritable told an author their content could not
    // be saved, which sent them looking for a value JSON refuses when the real
    // answer is that a value they hold will come back missing.
    expect(codesFor(styles)).toEqual([
      "document-lossy",
      "invalid-style-values",
    ]);
  });

  it("are refused at the breakpoint level too", () => {
    // The inherited key has to differ from the own one, or it is shadowed and
    // never enumerated separately, which would prove nothing.
    const byBreakpoint = Object.create({
      tablet: { nope: "1px" },
    }) as Record<string, unknown>;
    byBreakpoint.base = { display: "block" };
    // Both, for the same reason as the case above: the specific defect plus the
    // document-level statement that the stored form differs from what was
    // validated.
    expect(codesFor({ base: byBreakpoint })).toEqual([
      "document-lossy",
      "invalid-style-values",
    ]);
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
    //
    // Reported through `reason` rather than through a second flag. Both say a
    // cycle has no stored form at any size; the difference is that `exceeded`
    // remains the single "refused" boolean, so a caller asking only whether the
    // document fits keeps refusing this one. Two independent flags read as
    // tidier and are fail-OPEN — measured, that shape silently stopped the op
    // store refusing cyclic documents until the check was added by hand.
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

  it("reports over-limit ahead of unwritable when a document is both", () => {
    // A document can be BOTH unwritable and over the limit, and one `reason`
    // can only carry one of them. This used to be decided by traversal: the
    // walk returned at the first refusal it reached, and because the stack is
    // LIFO that made the answer depend on DECLARATION ORDER — the same two keys
    // swapped gave opposite reasons, which nothing outside the walk could
    // predict.
    //
    // Order is no longer what decides it. Over-limit is reported first, and the
    // reason is not aesthetic: the byte verdict is what gates the precise
    // validation walk downstream, so a document that loses it to the other
    // cause gets an UNBOUNDED traversal — the bound defeated by key order
    // alone.
    //
    // What this does NOT do is make precedence total, and nothing bounded can:
    // proving no unwritable value exists anywhere means reading the whole
    // document, which is the pass this counter exists to avoid. An unwritable
    // value inside a subtree the cap stopped us entering is still unreported.
    const padFirst = measureBytes({ pad: "x".repeat(500), bad: 1n }, 100);
    const badFirst = measureBytes({ bad: 1n, pad: "x".repeat(500) }, 100);

    expect(padFirst.exceeded && padFirst.reason).toBe("over-limit");
    expect(badFirst.exceeded && badFirst.reason).toBe("over-limit");

    // Unwritable is still reported on its own, so the ordering above is a
    // precedence rule rather than the reason being unreachable.
    const small = measureBytes({ bad: 1n }, 1_000);
    expect(small.exceeded && small.reason).toBe("unwritable");

    // And either way the document is refused, which is what a caller asking
    // only "does this fit" relies on.
    expect([padFirst.exceeded, badFirst.exceeded, small.exceeded]).toEqual([
      true,
      true,
      true,
    ]);
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

    // Refused, but NOT as a BigInt: the symbol-keyed property is one JSON
    // drops, so the document would not survive storage unchanged.
    const measuredSpoof = measureBytes({ v: spoof }, 1_000);
    expect(measuredSpoof.exceeded).toBe(true);

    // THE CONTROL THAT MATTERS. The same object without the symbol key is
    // accepted and measured exactly as the writer emits it, so the tag
    // contributed nothing to the refusal above — which is what would break if
    // classification ever moved back to `Object.prototype.toString`.
    const plain = { x: 1 };
    expect(measureBytes({ v: plain }, 1_000)).toEqual({
      bytes: Buffer.byteLength(JSON.stringify({ v: plain }), "utf8"),
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

describe("measureBytes reads nothing the writer would not", () => {
  it("does not invoke a Symbol.toStringTag getter the document defined", () => {
    // `JSON.stringify` ignores symbol keys, so it never runs this getter and
    // stores the object as `{}`. A measurement that runs it is executing
    // document-supplied code the writer does not, which lets a throwing getter
    // escape a function contracted to report rather than raise, and lets a
    // getter with side effects mutate a document while it is being measured.
    let reads = 0;
    const watched = { x: 1 };
    Object.defineProperty(watched, Symbol.toStringTag, {
      get: () => {
        reads += 1;
        return "BigInt";
      },
      configurable: true,
    });

    const measured = measureBytes({ v: watched }, 1_000);

    expect(reads, "the tag getter ran during measurement").toBe(0);
    // The verdict is a REFUSAL, and not for the reason this test guards. The
    // writer stores the object, but it stores it WITHOUT the symbol-keyed
    // property, and a member JSON drops is the same class as `undefined` and a
    // function — which this counter refuses so the stored document cannot
    // differ from the one that was checked. The control below is what shows
    // the tag played no part.
    expect(measured.exceeded).toBe(true);
  });

  it("does not raise when a tag getter throws, because the writer stores it", () => {
    const hostile = { x: 1 };
    Object.defineProperty(hostile, Symbol.toStringTag, {
      get: () => {
        throw new Error("tag getter");
      },
      configurable: true,
    });

    // The control: the writer really does accept this value, so refusing it
    // or raising here would be a disagreement with the thing being counted.
    expect(JSON.stringify({ v: hostile })).toBe('{"v":{"x":1}}');
    expect(() => measureBytes({ v: hostile }, 1_000)).not.toThrow();
    // Refused for carrying a symbol-keyed property, which JSON drops — never
    // by running the getter, which is the property this test exists for.
    expect(measureBytes({ v: hostile }, 1_000).exceeded).toBe(true);
  });

  it("still refuses a boxed BigInt that carries a tag of its own", () => {
    // The slot check is what a declared tag falls through to, so this is the
    // case proving the fall-through still reaches the right answer.
    const tagged = Object(1n) as object;
    Object.defineProperty(tagged, Symbol.toStringTag, {
      value: "Object",
      configurable: true,
    });
    expect(measureBytes({ v: tagged }, 1_000).exceeded).toBe(true);
  });
});

describe("measureBytes probes a value only where the writer does", () => {
  it("does not execute a proxy's descriptor trap", () => {
    // The writer reads `toJSON` and own keys, and never asks for
    // `Symbol.toStringTag`. A probe that does is observable through a Proxy
    // trap even when no ordinary getter is involved, and a trap that throws
    // turns a document the writer stores into a raised error.
    const trapped: string[] = [];
    const hostile = new Proxy(
      { x: 1 },
      {
        getOwnPropertyDescriptor(target, key) {
          trapped.push(String(key));
          if (key === Symbol.toStringTag) throw new Error("descriptor trap");
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      }
    );

    // The control: the writer really does accept it, so raising here would be
    // a disagreement with the thing being counted.
    expect(JSON.stringify({ v: hostile })).toBe('{"v":{"x":1}}');
    expect(() => measureBytes({ v: hostile }, 1_000)).not.toThrow();
    expect(
      trapped.filter(key => key.includes("toStringTag")),
      "the counter asked for a symbol the writer never asks for"
    ).toEqual([]);
  });

  it("refuses a boxed BigInt whose prototype was replaced", () => {
    // A prototype-based filter would call this an ordinary object. The writer
    // still refuses it, so the counter has to as well or the two disagree
    // about a document that cannot be stored.
    const disguised = Object(1n) as object;
    Object.setPrototypeOf(disguised, Object.prototype);

    expect(() => JSON.stringify({ v: disguised })).toThrow(TypeError);
    expect(measureBytes({ v: disguised }, 1_000).exceeded).toBe(true);
  });
});

describe("a document is told what is actually wrong with it", () => {
  it("calls a rewritten document rewritten, not unreadable", () => {
    // A node hook returning a replacement is READ perfectly well; JSON simply
    // rewrites it. Its survey is incomplete because the byte count is then the
    // original's, and reporting incompleteness as the verdict told an author the
    // validator refused to read a member it had read — sending them to look for
    // a member that is not the problem.
    const node = {
      id: "n1",
      type: "core/text",
      version: 1,
      props: {},
      toJSON() {
        return "x".repeat(2000);
      },
    };
    const codes = validate(
      invalidDoc({ formatVersion: 1, kind: "page", nodes: [node] }),
      { breakpoints: FIXTURE_BREAKPOINTS, mode: "strict" }
    ).map(issue => issue.code);

    expect(codes).toContain("document-lossy");
    expect(codes).not.toContain("document-unreadable");
  });

  it("still calls an unread member unreadable", () => {
    // The other direction, so the case above cannot pass by never reporting
    // `document-unreadable` at all. An accessor IS a member the walk declined
    // to read, and that verdict is the true one.
    const props: Record<string, unknown> = {};
    Object.defineProperty(props, "payload", {
      enumerable: true,
      get() {
        return "x".repeat(100);
      },
    });
    const codes = validate(
      invalidDoc({
        formatVersion: 1,
        kind: "page",
        nodes: [{ id: "n1", type: "core/text", version: 1, props }],
      }),
      { breakpoints: FIXTURE_BREAKPOINTS, mode: "strict" }
    ).map(issue => issue.code);

    expect(codes).toContain("document-unreadable");
    expect(codes).not.toContain("document-lossy");
  });
});

describe("an unstorable document does not have its values parsed", () => {
  it("does not enumerate a classes list the byte pass never measured", () => {
    // An accessor is the walk's own blind spot: reading it runs code the survey
    // refuses to run, so whatever it holds was never counted and nothing
    // downstream is bounded by the byte cap. Validation must not then reach the
    // same field by ordinary property access and walk it in full.
    let reads = 0;
    const node = {
      id: "n1",
      type: "core/text",
      version: 1,
      props: {},
      get classes() {
        reads += 1;
        return Array.from({ length: 5_000 }, (_, i) => `c${i}`);
      },
    };
    const doc = invalidDoc({ formatVersion: 1, kind: "page", nodes: [node] });

    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
    });

    expect(issues.some(i => i.code === "document-unreadable")).toBe(true);
    // Zero, not "few". Every check in `validateClasses` re-reads the field, so
    // any read at all means the list was walked — the assertion has to be on
    // the field never being touched rather than on a count that looks small.
    expect(reads).toBe(0);
  });

  it("still validates the classes of a document JSON merely rewrites", () => {
    // The other side of the same gate, and the reason it has to be the narrow
    // question. A sparse array is fully measured — twelve bytes, written by
    // `JSON.stringify` as `[null,"cls"]` — so the work below IS bounded and
    // skipping it would drop a real, actionable issue about the document.
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

    expect(issues.some(i => i.code === "invalid-classes")).toBe(true);
    // And it is reported as rewritten rather than as impossible to store.
    expect(issues.some(i => i.code === "document-lossy")).toBe(true);
    expect(issues.some(i => i.code === "document-unwritable")).toBe(false);
  });

  it("still validates the classes of a document whose counts are approximate", () => {
    // A node hook returning a replacement leaves the walk having read the whole
    // document while the published byte total describes the replacement rather
    // than the node. So the counts stop being the writer's — but nothing about
    // the traversal stopped short, and the per-value work below is bounded by a
    // tree that was measured end to end.
    //
    // Separating the two is what this covers. A sparse array is fully measured
    // AND counted from itself, so it cannot tell a gate on "the numbers are the
    // writer's" from one on "the walk reached everything"; only a document that
    // is traversed and approximate at once distinguishes them.
    const classes: unknown[] = [];
    classes[1] = "cls";
    const node = {
      id: "n1",
      type: "core/text",
      version: 1,
      props: {},
      classes,
      // Structure is counted from the document and bytes from the replacement,
      // which is what withdraws the completeness claim without truncating the
      // walk.
      toJSON() {
        return { id: "n1", type: "core/text", version: 1, props: {} };
      },
    };
    const doc = invalidDoc({ formatVersion: 1, kind: "page", nodes: [node] });

    const { issues, survey } = validateDocument(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
    });

    // Asserted from the survey the validator itself judged the document with,
    // and BEFORE the issues: a fixture that stopped being approximate, or that
    // started tripping a cap, would leave every assertion below satisfied by a
    // document that never reached the gate at all.
    expect(survey.traversed).toBe(true);
    expect(survey.complete).toBe(false);

    expect(issues.some(i => i.code === "invalid-classes")).toBe(true);
  });

  it("skips per-value work when the byte pass could not measure the document", () => {
    // The byte precondition REFUSES to invoke an accessor, so it never learns
    // how large that field is. The per-value work below reaches the same field
    // by ordinary property access, runs the getter, and parses everything it
    // returns — so the one document whose size is UNKNOWN was the one whose
    // values were parsed in full.
    //
    // Counting getter invocations is what separates the implementations: both
    // report the document invalid, and only one of them reads the megabytes.
    let reads = 0;
    const node: Record<string, unknown> = {
      id: "n1",
      type: "core/text",
      version: 1,
      props: {},
    };
    Object.defineProperty(node, "styles", {
      get() {
        reads += 1;
        // A token reference the lookup below does NOT know, which is what
        // `validateStyleValues` reports — so this fixture produces a style
        // issue when parsed and none when skipped. Without that, the assertion
        // is satisfied by the fixture rather than by the behaviour.
        return { base: { base: { color: { $token: "no.such.token" } } } };
      },
      enumerable: true,
      configurable: true,
    });
    const doc = invalidDoc({
      formatVersion: 1,
      kind: "page",
      nodes: [node],
    });

    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      tokens: { kindOf: () => undefined },
    });

    // Refused, and refused for the right reason.
    expect(issues.some(i => i.code === "document-unreadable")).toBe(true);

    // The style tree behind the accessor is never PARSED, which is the
    // unbounded work: every value builds an AST apiece, and the byte pass
    // refused to measure this field so nothing bounded it.
    expect(
      issues.some(
        i => i.code === "invalid-style-values" || i.code === "unknown-token"
      )
    ).toBe(false);

    // What this does NOT do, stated rather than implied: the property is still
    // READ, so the getter still runs. Skipping the read entirely would mean not
    // validating the node's shape at all, and a document is refused on its
    // shape long before its style values matter. The exposure that closes is
    // the parsing of whatever the getter returns, not the single invocation.
    expect(reads).toBeGreaterThan(0);
  });
});

describe("validate and compile agree on which breakpoints a site defines", () => {
  // The validate-then-compile contract. A caller runs `validate()` and, seeing
  // no issue, stores the document; the compiler then drops a definition
  // validation counted as known, and every style keyed to it compiles to nothing
  // — reported as an unknown breakpoint by a pass the author never ran.
  //
  // Asserted as a PAIR each time, because either half alone can be satisfied by
  // the wrong thing: an issue from validation proves nothing if the compiler
  // emits the CSS anyway, and missing CSS proves nothing if validation warned.
  const styled = (breakpointId: string, breakpoints: BreakpointSet) => ({
    document: {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          styles: { base: { [breakpointId]: { color: "red" } } },
        } as BlockNode,
      ],
    } satisfies BlockDocument,
    breakpoints,
  });

  const agrees = (breakpointId: string, breakpoints: BreakpointSet) => {
    const { document } = styled(breakpointId, breakpoints);
    const issues = validate(document, { breakpoints, mode: "forgiving" });
    const compiled = compilePageCss(document, { breakpoints });
    return {
      validationSaw: issues.some(issue => issue.code === "unknown-breakpoint"),
      compilerSaw: compiled.warnings.some(
        issue => issue.code === "unknown-breakpoint"
      ),
      emitted: compiled.css.includes("color: red"),
    };
  };

  it("agrees about an id longer than the compiler will read", () => {
    const huge = "b".repeat(MAX_BREAKPOINT_ID_LENGTH + 1);
    const seen = agrees(huge, {
      viewport: [{ id: huge, label: "Huge", maxWidth: 700 }],
      container: [],
    });

    expect(seen.compilerSaw).toBe(true);
    expect(seen.validationSaw).toBe(true);
    expect(seen.emitted).toBe(false);
  });

  it("agrees about a viewport definition carrying no bound", () => {
    // Older than the length rule and the same divergence: the compiler drops an
    // unbounded viewport definition because it would emit no at-rule at all, and
    // the scan counted it as a breakpoint this site defines.
    const seen = agrees("unbounded", {
      viewport: [{ id: "unbounded", label: "Unbounded" }],
      container: [],
    });

    expect(seen.compilerSaw).toBe(true);
    expect(seen.validationSaw).toBe(true);
  });

  it("agrees that BASE is defined even when the stored set names it nowhere", () => {
    // The opposite direction, which the scan also got wrong. The compiler always
    // carries the base context, so a style keyed to `base` compiles — and a
    // validation deriving its known ids from the stored definitions alone would
    // report a value that is perfectly good.
    const seen = agrees("base", {
      viewport: [{ id: "md", label: "Medium", maxWidth: 768 }],
      container: [],
    });

    expect(seen.compilerSaw).toBe(false);
    expect(seen.validationSaw).toBe(false);
    expect(seen.emitted).toBe(true);
  });
});

describe("a bag validation has already refused is never enumerated", () => {
  it("does not run an accessor the document supplied", () => {
    // `Object.entries` invokes a getter. A throwing one would escape
    // `validate()` as a native error rather than an issue, and a
    // side-effecting one would execute the document's own code inside the
    // check deciding whether to trust it.
    let ran = false;
    const bag = Object.create(
      {},
      {
        id: {
          enumerable: true,
          get() {
            ran = true;
            throw new Error("a document should not get to run this");
          },
        },
      }
    ) as Record<string, string>;

    const doc = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        { id: "n1", type: "core/text", version: 1, props: {}, attributes: bag },
      ],
    } as unknown as BlockDocument;

    expect(() =>
      validateDocument(doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
      })
    ).not.toThrow();
    expect(ran).toBe(false);
    // And it is still REPORTED, rather than quietly skipped.
    expect(
      validateDocument(doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
      }).issues.some(issue => issue.code === "invalid-attributes")
    ).toBe(true);
  });

  it("still registers the cssId of a node whose bag it refused", () => {
    // The control for the fallback. With the bag unreadable `cssId` is the only
    // place an id can come from, and dropping it would lose a real duplicate.
    const bag = Object.create({}, { id: { enumerable: true, get: () => "x" } });
    const doc = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/text",
          version: 1,
          props: {},
          cssId: "hero",
          attributes: bag,
        },
        { id: "n2", type: "core/text", version: 1, props: {}, cssId: "hero" },
      ],
    } as unknown as BlockDocument;

    expect(
      validateDocument(doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
      }).issues.some(issue => issue.code === "duplicate-dom-id")
    ).toBe(true);
  });
});

describe("the gating read stays inside the node budget", () => {
  it("does not touch a node beyond maxNodes", () => {
    // The check that decides whether a node is pruned reads `visibility`. Doing
    // that in a pass of its own walked the whole forest, outside the one loop
    // bounded by `maxNodes` — so an oversized document was traversed in full by
    // a check the cap exists to stop.
    //
    // Observable because a getter is observable: the node carrying it sits past
    // the cap, so a bounded walk never reads it.
    let readPastTheCap = false;
    const beyond = { id: "n3", type: "core/text", version: 1, props: {} };
    Object.defineProperty(beyond, "visibility", {
      enumerable: true,
      get() {
        readPastTheCap = true;
        return undefined;
      },
    });

    const doc = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        { id: "n1", type: "core/text", version: 1, props: {} },
        { id: "n2", type: "core/text", version: 1, props: {} },
        beyond,
      ],
    } as unknown as BlockDocument;

    validateDocument(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      limits: { ...DEFAULT_LIMITS, maxNodes: 2 },
    });

    expect(readPastTheCap).toBe(false);
  });
});
