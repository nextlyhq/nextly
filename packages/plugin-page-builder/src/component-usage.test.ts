import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { reconcileUsage } from "./class-usage-reconcile";
import { componentUsageIndex, componentUsageOf } from "./component-usage";

const COMPONENT_INSTANCE_TYPE = "nextly/component-instance";

const box = (id: string) => ({ id, type: "core/box", version: 1, props: {} });
const instance = (id: string, componentId: string) => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
});
const doc = (nodes: unknown[]) => ({ formatVersion: 1, kind: "page", nodes });

describe("what a stored document says about the components it embeds", () => {
  it("names each component once, and reports a whole read", () => {
    const stored = doc([
      instance("i1", "header"),
      { ...box("wrap"), slots: { children: [instance("i2", "header")] } },
      instance("i3", "footer"),
    ]);

    expect(componentUsageOf(stored, DEFAULT_LIMITS)).toEqual({
      ids: ["header", "footer"],
      complete: true,
    });
  });

  it("reads a document stored as JSON text", () => {
    // The column can hold either, and a reader that handled only the object
    // would answer "references nothing" for every site whose adapter stores
    // JSON as text — the direction that permits deleting a component in use.
    const stored = JSON.stringify(doc([instance("i1", "header")]));

    expect(componentUsageOf(stored, DEFAULT_LIMITS)).toEqual({
      ids: ["header"],
      complete: true,
    });
  });

  it("says it could NOT read a document past the node cap", () => {
    // Both halves asserted together: `ids: []` on its own is also what a
    // document holding no instances answers, and separating those two is the
    // entire reason this returns a pair.
    const stored = doc([
      ...Array.from({ length: DEFAULT_LIMITS.maxNodes + 10 }, (_, i) =>
        box(`n${i}`)
      ),
      instance("i1", "header"),
    ]);

    expect(componentUsageOf(stored, DEFAULT_LIMITS)).toEqual({
      ids: [],
      complete: false,
    });
  });

  it("treats a value that is not a document as referencing nothing, READABLY", () => {
    // `complete: true`, deliberately. Reporting these as unreadable would put a
    // marker row against a subject whose document is simply absent, and no
    // rebuild could ever clear it — the row would count towards its components
    // for ever.
    for (const stored of [
      undefined,
      null,
      42,
      "not json at all",
      {},
      { nodes: "not an array" },
      doc([]),
    ]) {
      expect({
        stored,
        usage: componentUsageOf(stored, DEFAULT_LIMITS),
      }).toEqual({ stored, usage: { ids: [], complete: true } });
    }
  });
});

describe("a stored row that contradicts itself", () => {
  const subject = {
    scope: "collection" as const,
    entity: "pages",
    entityKey: "p1",
    field: "content",
    locale: "",
    variant: "published" as const,
  };

  it("does not let a malformed marker suppress the real reference", () => {
    // A row can say it could not read the page AND name a component — after a
    // restore, a hand edit, or a super-admin write. Keyed on the component id
    // alone, that row and a genuine reference to the same component look like
    // ONE record: the malformed one is kept, the real one is never inserted,
    // and no later save can tell them apart to repair it.
    //
    // With the kind in the key it is simply a row no derivation claims, so the
    // next save removes it and inserts the reference.
    const malformed = {
      ...subject,
      kind: "unreadable" as const,
      componentId: "header",
      id: "row-1",
    };
    const derived = [componentUsageIndex.rowFor(subject, "header")];

    const { insert, remove } = reconcileUsage(
      componentUsageIndex,
      subject,
      derived,
      [malformed]
    );

    expect({
      inserted: insert.map(r => `${r.kind}:${r.componentId}`),
      removed: remove,
    }).toEqual({ inserted: ["reference:header"], removed: ["row-1"] });
  });

  it("keeps a well-formed marker while the page still cannot be read", () => {
    // The control. Without it, a key that simply never matched anything would
    // satisfy the case above by removing every stored row and re-inserting.
    const marker = { ...componentUsageIndex.markerFor(subject), id: "row-1" };

    const { insert, remove } = reconcileUsage(
      componentUsageIndex,
      subject,
      [componentUsageIndex.markerFor(subject)],
      [marker]
    );

    expect({ inserted: insert.length, removed: remove }).toEqual({
      inserted: 0,
      removed: [],
    });
  });
});
