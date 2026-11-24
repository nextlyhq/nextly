/**
 * Rows and instances an earlier release stored without an id get one id at one place in every
 * language (`withPositionIds`). The plausible broken versions: an id minted per language (no
 * language's text could be kept by it), ids given where the lists differ (one language's row
 * would take another's text), and a stored id replaced.
 */
import { describe, expect, it } from "vitest";

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

type Row = { id?: string; label?: string; cards?: Row[] };

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
