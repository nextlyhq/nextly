/**
 * Rows and instances an earlier release stored without an id get one id at one place in every
 * language (`withPositionIds`). The plausible broken versions: an id minted per language (no
 * language's text could be kept by it), ids given where the lists differ (one language's row
 * would take another's text), and a stored id replaced.
 */
import { describe, expect, it } from "vitest";

import { currentFieldGroupTypeKey } from "../../../../domains/field-groups/storage/field-group-type-key";
import type { SharedStructureShape } from "../../../../domains/i18n/shared-structure";
import { withPositionIds } from "../position-ids";

const CARDS: SharedStructureShape = {
  kind: "repeater",
  texts: ["label"],
  inner: {},
};
const PANELS: SharedStructureShape = {
  kind: "repeater",
  texts: [],
  inner: { cards: CARDS },
};

type Row = { id?: string; label?: string; cards?: Row[]; items?: Row[] };

// A dynamic zone whose two types reuse a nested name with a different cardinality: `quote`
// places one item there, `list` a repeatable list of them. The zone's merged shape keeps the first
// type's, so only each instance's own type (`byType`) says that a `list` holds rows.
const ONE_ITEM: SharedStructureShape = {
  kind: "group",
  texts: ["label"],
  inner: {},
};
const ITEMS: SharedStructureShape = {
  kind: "repeater",
  texts: ["label"],
  inner: {},
};
const ZONE: SharedStructureShape = {
  kind: "repeater",
  texts: [],
  inner: { items: ONE_ITEM },
  byType: {
    quote: { kind: "repeater", texts: [], inner: { items: ONE_ITEM } },
    list: { kind: "repeater", texts: [], inner: { items: ITEMS } },
  },
};

describe("withPositionIds", () => {
  it("gives each place one id, the same in every language", () => {
    const aligned = withPositionIds(
      new Map<string, unknown>([
        ["en", [{ label: "one" }, { label: "two" }]],
        ["es", [{ label: "uno" }, { label: "dos" }]],
      ]),
      CARDS,
      "en"
    );
    const en = aligned.get("en") as Row[];
    const es = aligned.get("es") as Row[];
    expect(en.map(row => row.id)).toEqual(es.map(row => row.id));
    expect(new Set(en.map(row => row.id)).size).toBe(2);
    expect(es.map(row => row.label)).toEqual(["uno", "dos"]);
  });

  it("gives no id where a language's list is not as long as the default language's", () => {
    const aligned = withPositionIds(
      new Map<string, unknown>([
        ["en", [{ label: "one" }, { label: "two" }]],
        ["es", [{ label: "uno" }]],
      ]),
      CARDS,
      "en"
    );
    expect((aligned.get("en") as Row[]).map(row => row.id)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("keeps a stored id, and reads a value stored as text", () => {
    const aligned = withPositionIds(
      new Map<string, unknown>([
        ["en", JSON.stringify([{ id: "r1", label: "one" }])],
        ["es", JSON.stringify([{ id: "r1", label: "uno" }])],
      ]),
      CARDS,
      "en"
    );
    expect(aligned.get("es")).toEqual([{ id: "r1", label: "uno" }]);
  });

  // Broken (the merged shape read for every instance), a `list` instance's rows are taken for one
  // item and get no id, so their languages are refused or their text left in the structure.
  it("gives the rows inside an instance their ids by the instance's own type", () => {
    const zone = (label: string) => [
      { id: "z1", [currentFieldGroupTypeKey]: "list", items: [{ label }] },
    ];
    const aligned = withPositionIds(
      new Map<string, unknown>([
        ["en", zone("one")],
        ["es", zone("uno")],
      ]),
      ZONE,
      "en"
    );
    const en = (aligned.get("en") as Row[])[0]!.items!;
    const es = (aligned.get("es") as Row[])[0]!.items!;
    expect(en[0]!.id).toBeDefined();
    expect(es[0]!.id).toBe(en[0]!.id);
    expect(es[0]!.label).toBe("uno");
  });

  it("gives the instances inside each row their ids too", () => {
    const aligned = withPositionIds(
      new Map<string, unknown>([
        ["en", [{ id: "p1", cards: [{ label: "one" }] }]],
        ["es", [{ id: "p1", cards: [{ label: "uno" }] }]],
      ]),
      PANELS,
      "en"
    );
    const en = (aligned.get("en") as Row[])[0]!.cards!;
    const es = (aligned.get("es") as Row[])[0]!.cards!;
    expect(en[0]!.id).toBeDefined();
    expect(es[0]!.id).toBe(en[0]!.id);
  });
});
