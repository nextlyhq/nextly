import { describe, expect, it } from "vitest";

import { validateBlocksValue } from "./blocks-validator";

/** A minimal valid page document. */
function page(nodes: unknown[] = []) {
  return { formatVersion: 1, kind: "page", nodes };
}

/** A node the engine accepts structurally. */
function node(type: string, id: string) {
  return { id, type, version: 1, props: {} };
}

describe("validateBlocksValue", () => {
  it("accepts an absent document, leaving required-ness to the shared rules", () => {
    expect(validateBlocksValue(null, "content", "Content", {})).toEqual([]);
    expect(validateBlocksValue(undefined, "content", "Content", {})).toEqual(
      []
    );
  });

  it("accepts a well-formed page document", () => {
    expect(
      validateBlocksValue(
        page([node("core/heading", "11111111-1111-4111-8111-111111111111")]),
        "content",
        "Content",
        {}
      )
    ).toEqual([]);
  });

  it("rejects a value that is not a document", () => {
    for (const value of ["text", 42, [], true]) {
      const issues = validateBlocksValue(value, "content", "Content", {});
      expect(issues.map(issue => issue.code)).toEqual(["INVALID_TYPE"]);
    }
  });

  it("reports the engine's own codes rather than a second vocabulary", () => {
    const issues = validateBlocksValue(
      { formatVersion: 1, kind: "page", nodes: "not-a-list" },
      "content",
      "Content",
      {}
    );
    expect(issues.length).toBeGreaterThan(0);
    // Kebab-case codes come from the engine's documented issue vocabulary.
    expect(issues[0]?.code).toMatch(/^[a-z][a-z-]+$/);
  });

  it("addresses issues to the field, with the position in the message", () => {
    const issues = validateBlocksValue(
      page([{ id: "", type: "core/heading", version: 1, props: {} }]),
      "content",
      "Content",
      {}
    );
    expect(issues.length).toBeGreaterThan(0);
    // The admin renders a blocks field as one control, so every issue lands on
    // the field; the document pointer travels in the message.
    for (const issue of issues) {
      expect(issue.path).toBe("content");
      expect(issue.message.startsWith("Content")).toBe(true);
    }
  });

  describe("document kind", () => {
    it("accepts only page documents by default", () => {
      const issues = validateBlocksValue(
        { formatVersion: 1, kind: "pattern", nodes: [] },
        "content",
        "Content",
        {}
      );
      expect(issues.map(issue => issue.code)).toContain(
        "DISALLOWED_DOCUMENT_KIND"
      );
    });

    it("accepts the kinds a field declares", () => {
      expect(
        validateBlocksValue(
          { formatVersion: 1, kind: "pattern", nodes: [] },
          "content",
          "Content",
          { kinds: ["page", "pattern"] }
        )
      ).toEqual([]);
    });
  });

  describe("allowed block types", () => {
    const doc = page([
      node("core/heading", "11111111-1111-4111-8111-111111111111"),
      node("acme/pricing", "22222222-2222-4222-8222-222222222222"),
    ]);

    it("permits every block when the field names none", () => {
      expect(validateBlocksValue(doc, "content", "Content", {})).toEqual([]);
    });

    it("rejects a block the field does not accept", () => {
      const issues = validateBlocksValue(doc, "content", "Content", {
        allow: ["core/heading"],
      });
      expect(issues.map(issue => issue.code)).toEqual([
        "DISALLOWED_BLOCK_TYPE",
      ]);
      expect(issues[0]?.message).toContain("acme/pricing");
    });

    it("matches a namespace through a trailing star", () => {
      expect(
        validateBlocksValue(doc, "content", "Content", {
          allow: ["core/*", "acme/*"],
        })
      ).toEqual([]);
      const issues = validateBlocksValue(doc, "content", "Content", {
        allow: ["core/*"],
      });
      expect(issues[0]?.message).toContain("acme/pricing");
    });

    it("names every disallowed type once, sorted", () => {
      const many = page([
        node("acme/b", "11111111-1111-4111-8111-111111111111"),
        node("acme/a", "22222222-2222-4222-8222-222222222222"),
        node("acme/b", "33333333-3333-4333-8333-333333333333"),
      ]);
      const issues = validateBlocksValue(many, "content", "Content", {
        allow: ["core/*"],
      });
      expect(issues[0]?.message).toContain("acme/a, acme/b");
    });

    it("reaches blocks nested inside slots", () => {
      const nested = page([
        {
          id: "11111111-1111-4111-8111-111111111111",
          type: "core/section",
          version: 1,
          props: {},
          slots: {
            default: [
              node("acme/pricing", "22222222-2222-4222-8222-222222222222"),
            ],
          },
        },
      ]);
      const issues = validateBlocksValue(nested, "content", "Content", {
        allow: ["core/*"],
      });
      expect(issues.map(issue => issue.code)).toEqual([
        "DISALLOWED_BLOCK_TYPE",
      ]);
    });
  });

  it("treats an empty allow-list as permitting nothing", () => {
    // Omitting `allow` and declaring `allow: []` are different statements;
    // reading them the same way would ignore the stricter one.
    const issues = validateBlocksValue(
      page([node("core/heading", "11111111-1111-4111-8111-111111111111")]),
      "content",
      "Content",
      { allow: [] }
    );
    expect(issues.map(issue => issue.code)).toEqual(["DISALLOWED_BLOCK_TYPE"]);
    expect(issues[0]?.message).toContain("Accepted: none");
  });

  it("does not walk a document the engine already rejected", () => {
    // A malformed node would throw inside the allow-list walk, turning a
    // rejected document into a server error.
    for (const nodes of [[null], [42], ["text"], [{ id: "a" }]]) {
      expect(() =>
        validateBlocksValue(page(nodes), "content", "Content", {
          allow: ["core/*"],
        })
      ).not.toThrow();
      const issues = validateBlocksValue(page(nodes), "content", "Content", {
        allow: ["core/*"],
      });
      // The structural failure is reported; the allow-list rule stays quiet
      // until there is a well-formed tree to check.
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.map(issue => issue.code)).not.toContain(
        "DISALLOWED_BLOCK_TYPE"
      );
    }
  });

  it("caps how many issues one field reports and says how many it withheld", () => {
    // Every node carries the same defect, so the document produces far more
    // issues than a writer could act on.
    const broken = page(
      Array.from({ length: 40 }, () => ({
        id: "",
        type: "core/heading",
        version: 1,
        props: {},
      }))
    );
    const issues = validateBlocksValue(broken, "content", "Content", {});
    expect(issues.length).toBe(21);
    expect(issues.at(-1)?.code).toBe("TOO_MANY_ISSUES");
    expect(issues.at(-1)?.message).toMatch(/further problems? not listed/);
  });

  it("does not throw on a hostile document", () => {
    const hostile: Record<string, unknown> = { formatVersion: 1, kind: "page" };
    hostile.nodes = [{ id: "a", type: "core/x", version: 1, props: hostile }];
    expect(() =>
      validateBlocksValue(hostile, "content", "Content", {})
    ).not.toThrow();
  });
});
