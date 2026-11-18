import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "./document";
import type { MigrationSource } from "./migration";
import {
  findMigrationGaps,
  migrateDocument,
  migrateProps,
  migrationInfoOf,
  nodeAtPointer,
} from "./migration";
import { componentEnvelopeIssues } from "./validation-components";

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
      drops?: Record<number, readonly string[]>;
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

describe("resolving a reported pointer", () => {
  const src = source({
    "core/heading": {
      version: 2,
      migrate: { 1: (p: Record<string, unknown>) => ({ ...p, level: 2 }) },
    },
    "core/box": { version: 1 },
  });

  it("addresses a node in a slot whose NAME needs escaping", () => {
    // The separating case. A slot called `hero/main` produces a pointer with the
    // slash escaped, so a consumer that rebuilds paths by joining raw names
    // looks up a pointer the producer never wrote — and misses the node
    // silently, which is indistinguishable from the node not having changed.
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
            "hero/main": [
              { id: "deep", type: "core/heading", version: 1, props: {} },
            ],
          },
        },
      ],
    } as unknown as BlockDocument;

    const { doc: out, rewritten } = migrateDocument(doc, src);

    expect(rewritten).toHaveLength(1);
    expect(rewritten[0]?.path).toBe("/nodes/0/slots/hero~1main/0");
    // Resolves in BOTH documents, which is what lets a caller recover the props
    // a node was stored with after migration has replaced them.
    expect(nodeAtPointer(out, rewritten[0]!.path)).toMatchObject({
      id: "deep",
      version: 2,
    });
    expect(nodeAtPointer(doc, rewritten[0]!.path)).toMatchObject({
      id: "deep",
      version: 1,
    });
    // The naive join, for contrast: it addresses nothing.
    expect(nodeAtPointer(out, "/nodes/0/slots/hero/main/0")).toBeUndefined();
  });

  it("answers undefined rather than a neighbour for a bad index", () => {
    const doc: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "a", type: "core/box", version: 1, props: {} }],
    };
    expect(nodeAtPointer(doc, "/nodes/0")).toMatchObject({ id: "a" });
    // `01` and `1.0` both coerce to a valid index numerically; RFC 6901 says a
    // non-canonical index addresses nothing, and silently returning element 0
    // would hand a caller the wrong node's props.
    expect(nodeAtPointer(doc, "/nodes/01")).toBeUndefined();
    expect(nodeAtPointer(doc, "/nodes/1.0")).toBeUndefined();
    expect(nodeAtPointer(doc, "/nodes/-1")).toBeUndefined();
    expect(nodeAtPointer(doc, "")).toBeUndefined();
  });
});

describe("a slot named by a stored `__proto__`", () => {
  // Parsed rather than written as a literal: `{ __proto__: [...] }` in source
  // sets the prototype instead of creating a key, so a literal fixture would
  // never carry the own property this is about.
  function docWithProtoSlot(): BlockDocument {
    return JSON.parse(
      JSON.stringify({
        nodes: [
          {
            id: "host",
            type: "core/box",
            version: 1,
            props: {},
            slots: {
              PLACEHOLDER: [
                { id: "kept", type: "core/text", version: 1, props: {} },
              ],
              main: [{ id: "stale", type: "core/text", version: 1, props: {} }],
            },
          },
        ],
      }).replace('"PLACEHOLDER"', '"__proto__"')
    ) as BlockDocument;
  }

  it("is a shape the fixture actually produces", () => {
    // Positive control. Without it every assertion below would also pass on a
    // fixture that never had the key, which is the same green a working
    // rebuild produces.
    const slots = docWithProtoSlot().nodes[0]!.slots!;

    expect(Object.prototype.hasOwnProperty.call(slots, "__proto__")).toBe(true);
  });

  it("survives a migration that rewrites a DIFFERENT slot's node", () => {
    const doc = docWithProtoSlot();

    const result = migrateDocument(
      doc,
      source({
        "core/box": { version: 1 },
        "core/text": {
          version: 2,
          migrate: { 1: (p: Record<string, unknown>) => ({ ...p, v2: true }) },
        },
      })
    );

    const slots = result.doc.nodes[0]!.slots!;
    // The migration was asked to touch `core/text` nodes. Both slots hold one,
    // so a rebuild that lost the `__proto__` key would be deleting a node it
    // had just migrated.
    expect(Object.keys(slots)).toContain("__proto__");
    expect(JSON.stringify(slots)).toContain("__proto__");
    expect(Object.getPrototypeOf(slots)).toBe(Object.prototype);
    // And the migration itself still happened, so this is not passing because
    // nothing ran.
    expect(result.doc.nodes[0]!.slots!.main[0]!.props).toEqual({ v2: true });
  });
});

describe("a step's renames", () => {
  const same = (p: Record<string, unknown>) => p;
  const quote = {
    version: 2,
    migrate: { 1: same },
    renames: { 1: { citeUrl: "href" } },
  };
  const page = (node: Record<string, unknown>): BlockDocument =>
    ({ formatVersion: 1, kind: "page", nodes: [node] }) as BlockDocument;

  it("move a prop's value to its new name before the step runs", () => {
    const seen: Record<string, unknown>[] = [];
    const result = migrateProps(
      { text: "x", citeUrl: "/a" },
      1,
      2,
      { 1: p => (seen.push(p), p) },
      { 1: { citeUrl: "href" } }
    );
    expect(seen[0]).toEqual({ text: "x", href: "/a" });
    expect(result.props).toEqual({ text: "x", href: "/a" });
  });

  it("move a value bound to the renamed prop with it, in the same step", () => {
    const binding = { source: "entry", field: "url" };
    const { doc } = migrateDocument(
      page({
        id: "q",
        type: "core/quote",
        version: 1,
        props: { citeUrl: "/fallback" },
        bindings: { citeUrl: binding, text: { source: "entry", field: "t" } },
      }),
      source({ "core/quote": quote })
    );
    const [node] = doc.nodes;
    expect(node?.version).toBe(2);
    expect(node?.props).toEqual({ href: "/fallback" });
    expect(node?.bindings).toEqual({
      href: binding,
      text: { source: "entry", field: "t" },
    });
  });

  it("keep a value already at the new name, the newer of the two", () => {
    const result = migrateProps(
      { citeUrl: "/old", href: "/new" },
      1,
      2,
      { 1: same },
      { 1: { citeUrl: "href" } }
    );
    expect(result.props).toEqual({ citeUrl: "/old", href: "/new" });
  });

  it("move bindings only through the steps that ran", () => {
    const { doc } = migrateDocument(
      page({
        id: "q",
        type: "t",
        version: 1,
        props: { a: 1 },
        bindings: { a: { source: "x" }, b: { source: "y" } },
      }),
      source({
        t: {
          version: 3,
          migrate: {
            1: same,
            2: () => {
              throw new Error("no");
            },
          },
          renames: { 1: { a: "a2" }, 2: { b: "b2" } },
        } as never,
      })
    );
    // Step 1 ran, so `a` moved; step 2 failed, so `b` stays where it was.
    expect(doc.nodes[0]?.bindings).toEqual({
      a2: { source: "x" },
      b: { source: "y" },
    });
  });

  it("re-point a component's exposures of the renamed prop, on that node only", () => {
    // A placement's override is written through the exposure's path, so an
    // exposure left on the old name writes where the upgraded block no longer
    // reads, and every placement's own value is lost.
    const exposure = (id: string, nodeId: string, propPath: string) => ({
      id,
      label: id,
      nodeId,
      propPath,
      type: "url",
    });
    const component = {
      formatVersion: 1,
      kind: "component",
      nodes: [
        { id: "q", type: "core/quote", version: 1, props: { citeUrl: "/a" } },
        { id: "other", type: "t", version: 1, props: { citeUrl: "/b" } },
      ],
      exposed: [
        exposure("link", "q", "citeUrl"),
        exposure("deep", "q", "citeUrl.label"),
        exposure("words", "q", "text"),
        exposure("elsewhere", "other", "citeUrl"),
      ],
    } as unknown as BlockDocument;
    const { doc } = migrateDocument(
      component,
      source({ "core/quote": quote, t: { version: 1 } })
    );
    const paths = (doc as { exposed?: { id: string; propPath: string }[] })
      .exposed;
    expect(paths?.map(each => [each.id, each.propPath])).toEqual([
      ["link", "href"],
      ["deep", "href.label"],
      ["words", "text"],
      ["elsewhere", "citeUrl"],
    ]);
    // The stored document is left as it was.
    expect(
      (component as { exposed: { propPath: string }[] }).exposed[0]?.propPath
    ).toBe("citeUrl");
  });

  it("leave a component's exposures as the same list when nothing is renamed", () => {
    const exposed = [
      { id: "w", label: "w", nodeId: "q", propPath: "text", type: "text" },
    ];
    const component = {
      formatVersion: 1,
      kind: "component",
      nodes: [{ id: "q", type: "core/quote", version: 2, props: {} }],
      exposed,
    } as unknown as BlockDocument;
    const { doc } = migrateDocument(component, source({ "core/quote": quote }));
    expect((doc as { exposed?: unknown }).exposed).toBe(exposed);
  });

  it("reach every migration source through the one reading of a definition", () => {
    expect(migrationInfoOf(quote)).toEqual(quote);
    expect(migrationInfoOf({ version: 1 })).toEqual({ version: 1 });
  });
});

describe("a step's drops", () => {
  const same = (p: Record<string, unknown>) => p;
  const contents = {
    version: 2,
    migrate: { 1: same },
    drops: { 1: ["content"] },
  };
  const page = (node: BlockNode): BlockDocument => ({
    formatVersion: 1,
    kind: "page",
    nodes: [node],
  });

  it("drop the prop once its step has run, which still saw it", () => {
    const seen: Record<string, unknown>[] = [];
    const result = migrateProps(
      { title: "On this page", content: { root: {} } },
      1,
      2,
      { 1: p => (seen.push(p), p) },
      undefined,
      { 1: ["content"] }
    );
    expect(seen[0]).toHaveProperty("content");
    expect(result.props).toEqual({ title: "On this page" });
  });

  it("drop a value bound to the dropped prop, keeping every other binding", () => {
    const title = { $bind: "title" };
    const { doc } = migrateDocument(
      page({
        id: "toc",
        type: "core/table-of-contents",
        version: 1,
        props: { title: "On this page", content: { root: {} } },
        bindings: { content: { $bind: "body" }, title },
      }),
      source({ "core/table-of-contents": contents })
    );
    const [node] = doc.nodes;
    expect(node?.version).toBe(2);
    expect(node?.props).toEqual({ title: "On this page" });
    expect(node?.bindings).toEqual({ title });
  });

  it("leave no empty bindings behind when the dropped prop held the only one", () => {
    const { doc } = migrateDocument(
      page({
        id: "toc",
        type: "core/table-of-contents",
        version: 1,
        props: {},
        bindings: { content: { $bind: "body" } },
      }),
      source({ "core/table-of-contents": contents })
    );
    expect(doc.nodes[0]).not.toHaveProperty("bindings");
  });

  it("drop only through the steps that ran", () => {
    const { doc } = migrateDocument(
      page({
        id: "n",
        type: "t",
        version: 1,
        props: { a: 1, b: 2 },
        bindings: { a: { $bind: "x" }, b: { $bind: "y" } },
      }),
      source({
        t: {
          version: 3,
          migrate: {
            1: same,
            2: () => {
              throw new Error("no");
            },
          },
          drops: { 1: ["a"], 2: ["b"] },
        },
      })
    );
    // Step 1 ran, so `a` went; step 2 failed, so `b` stays with its binding.
    expect(doc.nodes[0]?.props).toEqual({ b: 2 });
    expect(doc.nodes[0]?.bindings).toEqual({ b: { $bind: "y" } });
  });

  it("remove a component's exposures into the dropped prop, on that node only", () => {
    // A placement writes its override through the exposure's path: one left
    // on a dropped prop writes where the upgraded block reads nothing.
    const exposure = (id: string, nodeId: string, propPath: string) => ({
      id,
      label: id,
      nodeId,
      propPath,
      type: "text",
    });
    const component = {
      formatVersion: 1,
      kind: "component",
      nodes: [
        {
          id: "toc",
          type: "core/table-of-contents",
          version: 1,
          props: { content: {} },
        },
        { id: "other", type: "t", version: 1, props: { content: "kept" } },
      ],
      exposed: [
        exposure("passage", "toc", "content"),
        exposure("deep", "toc", "content.root"),
        exposure("title", "toc", "title"),
        exposure("elsewhere", "other", "content"),
      ],
    } as unknown as BlockDocument;
    const { doc } = migrateDocument(
      component,
      source({ "core/table-of-contents": contents, t: { version: 1 } })
    );
    const left = (doc as { exposed?: { id: string }[] }).exposed;
    expect(left?.map(each => each.id)).toEqual(["title", "elsewhere"]);
  });

  it("take a dropped exposure's values out of every variant, so the component still saves", () => {
    // A variant naming a field the component no longer has fails the
    // component's save; one left with no values is kept, as removing a field
    // in the editor keeps it.
    const exposure = (id: string, propPath: string) => ({
      id,
      label: id,
      nodeId: "toc",
      propPath,
      type: "text",
    });
    const component = {
      formatVersion: 1,
      kind: "component",
      nodes: [
        {
          id: "toc",
          type: "core/table-of-contents",
          version: 1,
          props: { content: {}, title: "On this page" },
        },
      ],
      exposed: [exposure("passage", "content"), exposure("title", "title")],
      variants: {
        compact: {
          label: "Compact",
          overrides: { passage: "a", title: "Contents" },
        },
        bare: { label: "Bare", overrides: { passage: "b" } },
        plain: { label: "Plain", overrides: { title: "In short" } },
      },
    } as unknown as BlockDocument;
    const { doc } = migrateDocument(
      component,
      source({ "core/table-of-contents": contents })
    );
    expect((doc as { variants?: unknown }).variants).toEqual({
      compact: { label: "Compact", overrides: { title: "Contents" } },
      bare: { label: "Bare", overrides: {} },
      plain: { label: "Plain", overrides: { title: "In short" } },
    });
    expect(
      componentEnvelopeIssues(doc).filter(
        issue => issue.code === "variant-unknown-target"
      )
    ).toEqual([]);
  });

  it("keep a variant's value for an id another exposure still carries", () => {
    // Stored data can hold one id on two rows; while one remains, the field
    // is live and its variant values stay.
    const component = {
      formatVersion: 1,
      kind: "component",
      nodes: [
        { id: "toc", type: "core/table-of-contents", version: 1, props: {} },
        { id: "other", type: "t", version: 1, props: {} },
      ],
      exposed: [
        { id: "shared", label: "S", nodeId: "toc", propPath: "content" },
        { id: "shared", label: "S", nodeId: "other", propPath: "content" },
      ],
      variants: { one: { label: "One", overrides: { shared: "kept" } } },
    } as unknown as BlockDocument;
    const { doc } = migrateDocument(
      component,
      source({ "core/table-of-contents": contents, t: { version: 1 } })
    );
    expect((doc as { variants?: unknown }).variants).toEqual({
      one: { label: "One", overrides: { shared: "kept" } },
    });
  });

  it("reach every migration source through the one reading of a definition", () => {
    expect(migrationInfoOf(contents)).toEqual(contents);
  });
});
