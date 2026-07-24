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
