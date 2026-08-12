import { describe, expect, it } from "vitest";

import type { BlockDocument } from "./document";
import type { MigrationSource } from "./migration";
import { findMigrationGaps, migrateDocument, migrateProps } from "./migration";

/** A migration source from a plain record of type → info. */
function source(
  info: Record<
    string,
    {
      version: number;
      migrate?: Record<
        number,
        (p: Record<string, unknown>) => Record<string, unknown>
      >;
    }
  >
): MigrationSource {
  return { get: type => info[type] };
}

describe("migrateProps", () => {
  it("chains steps from the stored version up to the current version", () => {
    const map = {
      1: (p: Record<string, unknown>) => ({ ...p, a: 1 }),
      2: (p: Record<string, unknown>) => ({ ...p, b: 2 }),
    };
    const result = migrateProps({ text: "x" }, 1, 3, map);
    expect(result.failure).toBeUndefined();
    expect(result.props).toEqual({ text: "x", a: 1, b: 2 });
  });

  it("stops at a missing step and reports the gap", () => {
    const map = { 1: (p: Record<string, unknown>) => ({ ...p, a: 1 }) };
    const result = migrateProps({}, 1, 3, map);
    expect(result.props).toEqual({ a: 1 }); // last good, after the 1→2 step
    expect(result.failure).toEqual({
      fromVersion: 2,
      message: "No migration from version 2.",
    });
  });

  it("stops and reports when a step throws, keeping the last good props", () => {
    const map = {
      1: (p: Record<string, unknown>) => ({ ...p, a: 1 }),
      2: () => {
        throw new Error("boom");
      },
    };
    const result = migrateProps({}, 1, 3, map);
    expect(result.props).toEqual({ a: 1 });
    expect(result.failure?.fromVersion).toBe(2);
    expect(result.failure?.message).toBe("boom");
  });

  it("treats a non-object migration return as a failure", () => {
    const map = { 1: () => 42 as unknown as Record<string, unknown> };
    const result = migrateProps({}, 1, 2, map);
    expect(result.failure?.fromVersion).toBe(1);
  });

  it("is a no-op when already at the target version", () => {
    const result = migrateProps({ x: 1 }, 3, 3, {});
    expect(result.props).toEqual({ x: 1 });
    expect(result.failure).toBeUndefined();
  });

  it("reports failure.fromVersion as the version the props reached", () => {
    // 1→2 succeeds, 2→3 missing: props are now at the version-2 shape, so the
    // failure names version 2 (the from-version of the missing step).
    const map = { 1: (p: Record<string, unknown>) => ({ ...p, a: 1 }) };
    const result = migrateProps({}, 1, 3, map);
    expect(result.props).toEqual({ a: 1 });
    expect(result.failure?.fromVersion).toBe(2);
  });

  it("rejects a non-integer or infinite version range instead of looping", () => {
    expect(migrateProps({}, 1, Infinity, {}).failure).toBeDefined();
    expect(migrateProps({}, -Infinity, 3, {}).failure).toBeDefined();
    expect(migrateProps({}, 1.5, 3, {}).failure).toBeDefined();
    // An absurdly wide span is treated as malformed, not chained.
    expect(migrateProps({}, 0, 100_000, {}).failure).toBeDefined();
  });
});

describe("findMigrationGaps", () => {
  it("returns the from-versions missing a covering step", () => {
    const map = { 1: (p: Record<string, unknown>) => p };
    expect(findMigrationGaps(1, 4, map)).toEqual([2, 3]);
  });

  it("is empty when the chain is complete", () => {
    const map = {
      1: (p: Record<string, unknown>) => p,
      2: (p: Record<string, unknown>) => p,
    };
    expect(findMigrationGaps(1, 3, map)).toEqual([]);
  });

  it("reports all versions when there is no map", () => {
    expect(findMigrationGaps(2, 5, undefined)).toEqual([2, 3, 4]);
  });
});

describe("migrateDocument", () => {
  const src = source({
    "core/heading": {
      version: 3,
      migrate: {
        1: (p: Record<string, unknown>) => ({ ...p, level: p.level ?? 2 }),
        2: (p: Record<string, unknown>) => ({ ...p, align: "start" }),
      },
    },
    "core/text": { version: 1 },
    "core/broken": {
      version: 2,
      migrate: {
        1: () => {
          throw new Error("nope");
        },
      },
    },
  });

  it("upgrades a node across two steps and bumps its version", () => {
    const doc: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "n1", type: "core/heading", version: 1, props: { text: "Hi" } },
      ],
    };
    const { doc: out, failures } = migrateDocument(doc, src);
    expect(failures).toEqual([]);
    expect(out.nodes[0]).toMatchObject({
      version: 3,
      props: { text: "Hi", level: 2, align: "start" },
    });
    // Immutability: the input is untouched.
    expect(doc.nodes[0]!.version).toBe(1);
  });

  it("upgrades nested nodes and preserves unknown types untouched", () => {
    const doc: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "root",
          type: "plugin/unknown",
          version: 5,
          props: { keep: true },
          slots: {
            children: [
              { id: "h", type: "core/heading", version: 2, props: {} },
            ],
          },
        },
      ],
    };
    const { doc: out } = migrateDocument(doc, src);
    // Unknown type: untouched, including its version.
    expect(out.nodes[0]).toMatchObject({ version: 5, props: { keep: true } });
    // Nested known node: migrated from 2 → 3.
    expect(out.nodes[0]!.slots!.children[0]).toMatchObject({
      version: 3,
      props: { align: "start" },
    });
  });

  it("stamps a partially-migrated node at its last-good version", () => {
    // core/heading is v3 with steps 1→2 and 2→3; a node stored at v2 with a
    // BROKEN 2→3 step: props advance where they can, version lands at last-good.
    const partial = source({
      "core/heading": {
        version: 3,
        migrate: {
          1: (p: Record<string, unknown>) => ({ ...p, level: 2 }),
          2: () => {
            throw new Error("2to3 broke");
          },
        },
      },
    });
    const doc: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: "core/heading", version: 1, props: {} }],
    };
    const { doc: out, failures } = migrateDocument(doc, partial);
    // 1→2 applied, 2→3 failed: props at v2 shape, version stamped to 2.
    expect(out.nodes[0]).toMatchObject({
      version: 2,
      migrationFailed: true,
      props: { level: 2 },
    });
    expect(failures[0]).toMatchObject({ fromVersion: 2, toVersion: 3 });
  });

  it("leaves a node with a malformed version untouched instead of looping", () => {
    const doc = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "n1", type: "core/heading", version: -Infinity, props: {} },
      ],
    } as unknown as BlockDocument;
    let out: ReturnType<typeof migrateDocument> | undefined;
    expect(() => {
      out = migrateDocument(doc, src);
    }).not.toThrow();
    expect(out!.doc.nodes[0]).toMatchObject({ version: -Infinity });
  });

  it("flags a node whose migration fails and records the failure", () => {
    const doc: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "b", type: "core/broken", version: 1, props: { keep: 1 } }],
    };
    const { doc: out, failures } = migrateDocument(doc, src);
    expect(out.nodes[0]).toMatchObject({
      migrationFailed: true,
      props: { keep: 1 }, // last-good props preserved
    });
    // Version is NOT bumped on failure.
    expect(out.nodes[0]!.version).toBe(1);
    expect(failures).toEqual([
      {
        path: "/nodes/0",
        type: "core/broken",
        fromVersion: 1,
        toVersion: 2,
        message: "nope",
      },
    ]);
  });

  it("leaves an already-current node unchanged (same reference)", () => {
    const doc: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "t", type: "core/text", version: 1, props: {} }],
    };
    const { doc: out, failures } = migrateDocument(doc, src);
    expect(failures).toEqual([]);
    expect(out.nodes[0]).toBe(doc.nodes[0]);
  });

  it("does not touch a node ahead of the definition version", () => {
    const doc: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "h", type: "core/heading", version: 9, props: { x: 1 } }],
    };
    const { doc: out, failures } = migrateDocument(doc, src);
    expect(failures).toEqual([]);
    expect(out.nodes[0]).toMatchObject({ version: 9, props: { x: 1 } });
  });
});

/**
 * The report of rewritten nodes, guarded at the PRODUCER.
 *
 * A reader uses `rewritten` to decide which nodes still need examining, so the
 * load-bearing property is COMPLETENESS, not brevity: a node missing from the
 * report is silently exempted from whatever the reader was checking, with no
 * error and no slow path to notice. Guarding a consumer cannot see that — a
 * report naming three of four nodes still gets its three read correctly — so
 * these assert the report against an independent walk of the two documents.
 */
describe("migrateDocument's report of what it rewrote", () => {
  const src = source({
    "core/heading": {
      version: 3,
      migrate: {
        1: (p: Record<string, unknown>) => ({ ...p, level: p.level ?? 2 }),
        2: (p: Record<string, unknown>) => ({ ...p, align: "start" }),
      },
    },
    "core/box": { version: 1 },
    "core/broken": {
      version: 2,
      migrate: {
        1: () => {
          throw new Error("nope");
        },
      },
    },
    "core/half-broken": {
      version: 3,
      migrate: {
        1: (p: Record<string, unknown>) => ({ ...p, one: true }),
        2: () => {
          throw new Error("nope");
        },
      },
    },
  });

  /**
   * Every node whose OWN props object was replaced, found by comparing the two
   * documents rather than by asking the report.
   *
   * Derived independently on purpose: a check that reconstructed the report the
   * way the producer builds it would agree with a broken producer. Props
   * identity is the separating signal — a parent rebuilt because a child moved
   * keeps the very same props object.
   */
  function propsReplaced(
    before: BlockDocument,
    after: BlockDocument
  ): string[] {
    const found: string[] = [];
    const walk = (a: unknown, b: unknown, path: string): void => {
      if (
        typeof a !== "object" ||
        a === null ||
        typeof b !== "object" ||
        b === null
      ) {
        return;
      }
      const nodeA = a as Record<string, unknown>;
      const nodeB = b as Record<string, unknown>;
      if (nodeA.props !== nodeB.props) found.push(path);
      const slotsA = nodeA.slots;
      const slotsB = nodeB.slots;
      if (
        typeof slotsA === "object" &&
        slotsA !== null &&
        typeof slotsB === "object" &&
        slotsB !== null
      ) {
        for (const slot of Object.keys(slotsB as Record<string, unknown>)) {
          const childrenA = (slotsA as Record<string, unknown>)[slot];
          const childrenB = (slotsB as Record<string, unknown>)[slot];
          if (!Array.isArray(childrenA) || !Array.isArray(childrenB)) continue;
          childrenB.forEach((child, index) => {
            walk(childrenA[index], child, `${path}/slots/${slot}/${index}`);
          });
        }
      }
    };
    const nodesA = before.nodes;
    const nodesB = after.nodes;
    if (Array.isArray(nodesA) && Array.isArray(nodesB)) {
      nodesB.forEach((node, index) => {
        walk(nodesA[index], node, `/nodes/${index}`);
      });
    }
    return found;
  }

  it("names a rewritten node NESTED IN A SLOT, which a top-level walk misses", () => {
    const doc: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "outer",
          type: "core/box",
          version: 1,
          props: {},
          slots: {
            children: [
              { id: "inner", type: "core/heading", version: 1, props: {} },
            ],
          },
        },
      ],
    } as unknown as BlockDocument;

    const { doc: out, rewritten } = migrateDocument(doc, src);

    // The separating case. The outer box is at its current version and is
    // rebuilt ONLY because its child changed, so a report keyed on reference
    // inequality would name it and a report that never descended would name
    // nothing at all. Exactly one node was actually rewritten.
    expect(rewritten).toEqual([
      {
        path: "/nodes/0/slots/children/0",
        id: "inner",
        type: "core/heading",
        fromVersion: 1,
        toVersion: 3,
      },
    ]);
    expect(propsReplaced(doc, out)).toEqual(["/nodes/0/slots/children/0"]);
  });

  it("names every node whose props were replaced, and no others", () => {
    const doc: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "current", type: "core/box", version: 1, props: { a: 1 } },
        { id: "old", type: "core/heading", version: 1, props: {} },
        {
          id: "parent",
          type: "core/box",
          version: 1,
          props: {},
          slots: {
            children: [
              { id: "deep", type: "core/heading", version: 2, props: {} },
              { id: "steady", type: "core/box", version: 1, props: {} },
            ],
          },
        },
      ],
    } as unknown as BlockDocument;

    const { doc: out, rewritten } = migrateDocument(doc, src);

    // Compared as SETS against the independent walk. Asserting the report is
    // non-empty, or that each reported node really changed, would both pass on
    // a report that dropped one — the direction that matters is the walk's
    // finding being a subset of the report's.
    expect(rewritten.map(entry => entry.path).sort()).toEqual(
      propsReplaced(doc, out).sort()
    );
    expect(rewritten.map(entry => entry.path).sort()).toEqual([
      "/nodes/1",
      "/nodes/2/slots/children/0",
    ]);
  });

  it("names a PARTIALLY migrated node, at the version it reached", () => {
    const doc: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "h", type: "core/half-broken", version: 1, props: { keep: 1 } },
      ],
    };

    const { doc: out, rewritten, failures } = migrateDocument(doc, src);

    // Step 1 ran and step 2 threw, so the props are neither the stored ones nor
    // the current shape. A reader told this node was untouched would carry a
    // conclusion drawn from props that no longer exist. `toVersion` is the
    // level actually REACHED, not the definition's.
    expect(failures).toHaveLength(1);
    expect(rewritten).toEqual([
      {
        path: "/nodes/0",
        id: "h",
        type: "core/half-broken",
        fromVersion: 1,
        toVersion: 2,
      },
    ]);
    expect(propsReplaced(doc, out)).toEqual(["/nodes/0"]);
  });

  it("does NOT name a node whose FIRST step threw, leaving props untouched", () => {
    const doc: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "b", type: "core/broken", version: 1, props: { keep: 1 } }],
    };

    const { doc: out, rewritten, failures } = migrateDocument(doc, src);

    // The node IS flagged and DOES fail, but nothing ran, so its props are the
    // stored object and anything derived from them still holds. Reporting it
    // would be reporting the failure rather than the rewrite, and the two come
    // apart exactly here — which is why the report is keyed on the props object
    // rather than on the version stamp or on `migrationFailed`.
    expect(failures).toHaveLength(1);
    expect(out.nodes[0]).toMatchObject({ migrationFailed: true });
    expect(rewritten).toEqual([]);
    expect(propsReplaced(doc, out)).toEqual([]);
  });

  it("is empty when nothing was rewritten", () => {
    const doc: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "t", type: "core/box", version: 1, props: {} }],
    };

    const { doc: out, rewritten } = migrateDocument(doc, src);

    expect(rewritten).toEqual([]);
    expect(propsReplaced(doc, out)).toEqual([]);
  });
});
