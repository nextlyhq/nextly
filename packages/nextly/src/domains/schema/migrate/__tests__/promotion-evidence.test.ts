/**
 * What the applied migrations prove about a pending row's shape.
 *
 * 🔴 The failure this guards is asymmetric, and the tests are shaped around
 * that. A wrong `differs` withholds a collection from the dashboard forever
 * with nothing on screen to explain it; a wrong `matches` is only the previous
 * behaviour. So every case that cannot be answered must come back `unknown`,
 * and only a real disagreement may come back `differs`.
 */
import { describe, expect, it } from "vitest";

import { buildShapeEvidence, shapeVerdict } from "../promotion-evidence";
import type { LoadedSnapshot } from "../snapshot-source";

const TITLE = [{ name: "title", type: "text" }];
const TITLE_BODY = [
  { name: "title", type: "text" },
  { name: "body", type: "richText" },
];

function snap(
  file: string,
  applied: boolean,
  collections: { slug: string; fields: unknown[] }[],
  singles: { slug: string; fields: unknown[] }[] = []
): LoadedSnapshot {
  return {
    file,
    applied,
    snapshot: {
      collections: collections.map(c => ({
        ...c,
        tableName: `dc_${c.slug}`,
      })) as never,
      singles: singles.map(s => ({
        ...s,
        tableName: `ds_${s.slug}`,
      })) as never,
    },
  };
}

describe("buildShapeEvidence", () => {
  /*
   * 🔴 The whole point of the module. A generated-but-unapplied migration sits
   * on disk describing the shape the operator WANTS; letting it win would
   * promote the row on the strength of a file, which is the claim-outruns-
   * evidence defect this exists to close.
   */
  it("takes the newest APPLIED snapshot, not the newest snapshot", () => {
    const evidence = buildShapeEvidence([
      snap("0001.snapshot.json", true, [{ slug: "posts", fields: TITLE }]),
      snap("0002.snapshot.json", false, [
        { slug: "posts", fields: TITLE_BODY },
      ]),
    ]);

    // The row is waiting for TITLE_BODY; the database has only reached TITLE.
    expect(
      shapeVerdict({ slug: "posts", fields: TITLE_BODY }, evidence.collections)
    ).toBe("differs");
    expect(
      shapeVerdict({ slug: "posts", fields: TITLE }, evidence.collections)
    ).toBe("matches");
  });

  it("lets a later APPLIED snapshot supersede an earlier one", () => {
    // The control for the case above. Without it, an implementation that
    // always took the FIRST snapshot would satisfy it.
    const evidence = buildShapeEvidence([
      snap("0001.snapshot.json", true, [{ slug: "posts", fields: TITLE }]),
      snap("0002.snapshot.json", true, [{ slug: "posts", fields: TITLE_BODY }]),
    ]);

    expect(
      shapeVerdict({ slug: "posts", fields: TITLE_BODY }, evidence.collections)
    ).toBe("matches");
  });

  it("keeps collections and singles apart", () => {
    const evidence = buildShapeEvidence([
      snap(
        "0001.snapshot.json",
        true,
        [{ slug: "posts", fields: TITLE }],
        [{ slug: "home", fields: TITLE_BODY }]
      ),
    ]);

    expect(evidence.collections.has("posts")).toBe(true);
    expect(evidence.collections.has("home")).toBe(false);
    expect(evidence.singles.has("home")).toBe(true);
  });

  it("ignores field order, so a reordered snapshot is not a change", () => {
    // The hash normalizes; without that, an entity would read as differing
    // every time a generator emitted its fields in another order.
    const evidence = buildShapeEvidence([
      snap("0001.snapshot.json", true, [{ slug: "posts", fields: TITLE_BODY }]),
    ]);

    const reordered = [...TITLE_BODY].reverse();
    expect(
      shapeVerdict({ slug: "posts", fields: reordered }, evidence.collections)
    ).toBe("matches");
  });

  it("does not let an entry with no field array displace a usable one", () => {
    const evidence = buildShapeEvidence([
      snap("0001.snapshot.json", true, [{ slug: "posts", fields: TITLE }]),
      snap("0002.snapshot.json", true, [
        { slug: "posts", fields: undefined as never },
      ]),
    ]);

    // Still answerable from 0001 rather than turned unknown by a bad later row.
    expect(
      shapeVerdict({ slug: "posts", fields: TITLE }, evidence.collections)
    ).toBe("matches");
  });
});

describe("shapeVerdict answers unknown rather than guessing", () => {
  const evidence = buildShapeEvidence([
    snap("0001.snapshot.json", true, [{ slug: "posts", fields: TITLE }]),
  ]);

  it("is unknown for a slug no snapshot describes", () => {
    // A code-first collection. Withholding it would empty its dashboard.
    expect(
      shapeVerdict({ slug: "authors", fields: TITLE }, evidence.collections)
    ).toBe("unknown");
  });

  it("is unknown when the registry kind has no evidence at all", () => {
    // Field groups: snapshots carry collections and singles and nothing else.
    expect(shapeVerdict({ slug: "posts", fields: TITLE }, undefined)).toBe(
      "unknown"
    );
  });

  it("is unknown when the row carries no usable fields", () => {
    expect(shapeVerdict({ slug: "posts" }, evidence.collections)).toBe(
      "unknown"
    );
    expect(
      shapeVerdict({ slug: "posts", fields: "nope" }, evidence.collections)
    ).toBe("unknown");
  });

  it("is unknown for a record that is not a record", () => {
    expect(shapeVerdict(null, evidence.collections)).toBe("unknown");
    expect(shapeVerdict({ fields: TITLE }, evidence.collections)).toBe(
      "unknown"
    );
  });

  /*
   * 🔴 Both sides are hashed HERE. `calculateSchemaHash` folds
   * SYSTEM_SCHEMA_VERSION into its input, so a verdict taken from the row's
   * STORED hash would disagree for every row in the database the first time
   * that constant changes — withholding promotion everywhere at once. A row
   * whose stored hash is meaningless must still match on its fields.
   */
  it("reads the row's FIELDS, never its stored schema_hash", () => {
    expect(
      shapeVerdict(
        { slug: "posts", fields: TITLE, schemaHash: "stale-or-nonsense" },
        evidence.collections
      )
    ).toBe("matches");
  });
});
