/**
 * Every lock break in a document, located, and the one an edit adds.
 *
 * The editor asks these before an action, so they must answer exactly as a
 * save does: the parity cases hold them to validation's own lock issues on
 * the same documents. A walk that answered differently would let the editor
 * allow what the save then refuses, or refuse what the save accepts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DOCUMENT_FORMAT_VERSION } from "./document";
import type { BlockDocument, BlockNode } from "./document";
import { lockBreaksIn, lockRefusal } from "./lock-breaks";
import {
  clearBlocks,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
} from "./registry";
import { expandSlotDefaults, makeNode } from "./tree";
import { validateDocument } from "./validation";
import { FIXTURE_BREAKPOINTS } from "./validation.fixtures";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

beforeEach(() => {
  registerBlocks(
    [
      {
        ...base,
        name: "acme/headline",
        props: {
          text: { type: "text", role: "content" },
          align: { type: "select" },
        },
        defaultProps: { text: "Title", align: "left" },
      },
      { ...base, name: "acme/divider" },
      {
        ...base,
        name: "acme/card",
        slots: { body: { defaultBlock: [{ type: "acme/headline" }] } },
      },
      {
        ...base,
        name: "acme/sealed-card",
        slots: {
          body: {
            defaultBlock: [{ type: "acme/headline" }],
            lock: "contentOnly",
          },
        },
      },
      {
        ...base,
        name: "acme/fixed-row",
        slots: {
          items: {
            defaultBlock: [{ type: "acme/headline" }, { type: "acme/divider" }],
            lock: "all",
          },
        },
      },
      // A box between a lock and the card it holds, so the lock has to be
      // passed down two slots that declare none before it reaches a block.
      {
        ...base,
        name: "acme/box",
        slots: { inner: { defaultBlock: [{ type: "acme/card" }] } },
      },
      {
        ...base,
        name: "acme/deep-shelf",
        slots: {
          main: { defaultBlock: [{ type: "acme/box" }], lock: "contentOnly" },
        },
      },
      {
        ...base,
        name: "acme/sealed-shelf",
        slots: {
          main: { defaultBlock: [{ type: "acme/card" }], lock: "contentOnly" },
        },
      },
    ] as never,
    { source: "acme" }
  );
});

afterEach(() => {
  clearBlocks();
});

const sources = () => ({
  definitions: registryBlockSource(),
  nesting: registryNestingSource(),
});

function placed(type: string, id?: string): BlockNode {
  const node = makeNode(
    type,
    1,
    {},
    expandSlotDefaults(type, registryBlockSource(), registryNestingSource())
  );
  return id === undefined ? node : { ...node, id };
}

function page(...nodes: BlockNode[]): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  } as BlockDocument;
}

const clone = <T>(value: T): T => structuredClone(value);

/** Validation's lock issues, as path and code. */
function validationLocks(doc: BlockDocument, stored?: BlockDocument[]) {
  return validateDocument(doc, {
    breakpoints: FIXTURE_BREAKPOINTS,
    mode: "strict",
    ...sources(),
    ...(stored === undefined ? {} : { stored }),
  })
    .issues.filter(issue => issue.code.startsWith("locked-slot"))
    .map(issue => `${issue.code} ${issue.path}`)
    .sort();
}

function located(doc: BlockDocument, stored?: BlockDocument[]) {
  return lockBreaksIn(doc, {
    ...sources(),
    ...(stored === undefined ? {} : { stored }),
  })
    .map(found => `${found.code} ${found.path}`)
    .sort();
}

describe("lockBreaksIn", () => {
  it("finds none in a document as inserting places its blocks", () => {
    expect(
      lockBreaksIn(
        page(placed("acme/sealed-card"), placed("acme/fixed-row")),
        sources()
      )
    ).toEqual([]);
  });

  it("locates a slot that holds other blocks than it starts with, by holder, slot and rule", () => {
    const row = placed("acme/fixed-row", "row");
    row.slots!.items!.push(placed("acme/divider"));
    expect(lockBreaksIn(page(row), sources())).toEqual([
      expect.objectContaining({
        code: "locked-slot-altered",
        holderId: "row",
        holderType: "acme/fixed-row",
        slot: "items",
        lock: "all",
        path: "/nodes/0/slots/items",
      }),
    ]);
  });

  it("locates a block whose design changed inside contentOnly, naming what changed", () => {
    const card = placed("acme/sealed-card", "card");
    card.slots!.body![0]!.props.align = "right";
    expect(lockBreaksIn(page(card), sources())).toEqual([
      expect.objectContaining({
        code: "locked-slot-content-only",
        holderId: "card",
        slot: "body",
        path: "/nodes/0/slots/body/0",
        changes: ['prop "align"'],
      }),
    ]);
  });

  describe("agrees with validation", () => {
    const cases: [string, () => [BlockDocument, BlockDocument[]?]][] = [
      ["a document as placed", () => [page(placed("acme/sealed-card"))]],
      [
        "a slot locked all given a block more",
        () => {
          const row = placed("acme/fixed-row");
          row.slots!.items!.push(placed("acme/divider"));
          return [page(row)];
        },
      ],
      [
        "a slot locked all reordered",
        () => {
          const row = placed("acme/fixed-row");
          row.slots!.items!.reverse();
          return [page(row)];
        },
      ],
      [
        "a slot whose blocks were removed with the slot itself",
        () => {
          const row = placed("acme/fixed-row");
          delete row.slots!.items;
          return [page(row)];
        },
      ],
      [
        "a design change two levels beneath contentOnly",
        () => {
          const shelf = placed("acme/sealed-shelf");
          shelf.slots!.main![0]!.slots!.body![0]!.props.align = "right";
          return [page(shelf)];
        },
      ],
      [
        "a design change three levels beneath contentOnly",
        () => {
          const shelf = placed("acme/deep-shelf");
          shelf.slots!.main![0]!.slots!.inner![0]!.slots!.body![0]!.props.align =
            "right";
          return [page(shelf)];
        },
      ],
      [
        "a design change the stored version already holds",
        () => {
          const card = placed("acme/sealed-card");
          card.slots!.body![0]!.props.align = "right";
          return [page(card), [page(clone(card))]];
        },
      ],
      [
        "a design change the stored version does not hold",
        () => {
          const card = placed("acme/sealed-card");
          const stored = page(clone(card));
          card.slots!.body![0]!.props.align = "right";
          return [page(card), [stored]];
        },
      ],
    ];
    it.each(cases)("on %s", (_label, build) => {
      const [doc, stored] = build();
      expect(located(doc, stored)).toEqual(validationLocks(doc, stored));
    });

    it("on a case that has breaks, so agreement is not two empty lists", () => {
      const row = placed("acme/fixed-row");
      row.slots!.items!.reverse();
      expect(located(page(row))).not.toEqual([]);
    });
  });
});

describe("lockRefusal", () => {
  it("refuses an edit that gives a slot locked all a block more", () => {
    const row = placed("acme/fixed-row", "row");
    const before = page(row);
    const after = clone(before);
    after.nodes[0]!.slots!.items!.push(placed("acme/divider"));
    expect(lockRefusal(before, after, sources())).toEqual(
      expect.objectContaining({
        code: "locked-slot-altered",
        holderId: "row",
        slot: "items",
        lock: "all",
      })
    );
  });

  it("allows an edit that leaves an already broken slot as it was", () => {
    // Stored before locks were enforced: the row holds a block more. Editing
    // the headline's text leaves that break exactly as it was.
    const row = placed("acme/fixed-row", "row");
    row.slots!.items!.push(placed("acme/divider"));
    const before = page(row);
    const after = clone(before);
    after.nodes[0]!.slots!.items![0]!.props.text = "Spring sale";
    expect(lockRefusal(before, after, sources())).toBeUndefined();
  });

  it("refuses an edit that breaks a second slot while one is already broken", () => {
    const broken = placed("acme/fixed-row", "a");
    broken.slots!.items!.push(placed("acme/divider"));
    const before = page(broken, placed("acme/fixed-row", "b"));
    const after = clone(before);
    after.nodes[1]!.slots!.items!.reverse();
    expect(lockRefusal(before, after, sources())).toEqual(
      expect.objectContaining({ holderId: "b", slot: "items" })
    );
  });

  it("refuses a design change inside contentOnly and allows a content change", () => {
    const before = page(placed("acme/sealed-card", "card"));
    const content = clone(before);
    content.nodes[0]!.slots!.body![0]!.props.text = "Spring sale";
    expect(lockRefusal(before, content, sources())).toBeUndefined();

    const design = clone(before);
    design.nodes[0]!.slots!.body![0]!.props.align = "right";
    expect(lockRefusal(before, design, sources())).toEqual(
      expect.objectContaining({
        code: "locked-slot-content-only",
        changes: ['prop "align"'],
      })
    );
  });

  it("refuses changing a design part the document already changed to a third value", () => {
    // Stored with the headline aligned right, which nobody may change here.
    // Keeping "right" is no change; "justify" is, though the break sits at
    // the same place as the one the document already had.
    const card = placed("acme/sealed-card", "card");
    card.slots!.body![0]!.props.align = "right";
    const before = page(card);
    const kept = clone(before);
    kept.nodes[0]!.slots!.body![0]!.props.text = "Spring sale";
    expect(lockRefusal(before, kept, sources())).toBeUndefined();

    const third = clone(before);
    third.nodes[0]!.slots!.body![0]!.props.align = "justify";
    expect(lockRefusal(before, third, sources())).toEqual(
      expect.objectContaining({ code: "locked-slot-content-only" })
    );
  });

  it("allows a design part put back as the block starts, which is the repair", () => {
    const card = placed("acme/sealed-card", "card");
    card.slots!.body![0]!.props.align = "right";
    const before = page(card);
    const after = clone(before);
    after.nodes[0]!.slots!.body![0]!.props.align = "left";
    expect(lockRefusal(before, after, sources())).toBeUndefined();
  });
});
