/**
 * One wording for every lock refusal, naming the area and what it still
 * allows. Each rule's remedy differs, so a wording that ignored the lock and
 * said one thing for all of them would fail here.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument } from "@nextlyhq/blocks-engine";

import { refusalAnnouncement } from "./move-refusal";
import { lockRefusalWording, repairStepSentence } from "./lock-refusal";

const membership = (lock: "all" | "insert" | "contentOnly") =>
  lockRefusalWording({
    code: "locked-slot-altered",
    holderType: "acme/hero",
    lock,
    childType: undefined,
  });

describe("lockRefusalWording", () => {
  it("names the locked area by the block that holds it", () => {
    expect(membership("all").headline).toBe("This area of Hero is locked.");
  });

  it("says what each lock still allows", () => {
    expect(membership("all").remedy).toBe(
      "Its blocks can't be added, removed or moved."
    );
    expect(membership("insert").remedy).toBe(
      "Its blocks can be reordered, but not added or removed."
    );
    expect(membership("contentOnly").remedy).toBe(
      "Only its content can change. Its blocks can't be added, removed or moved."
    );
  });

  it("says a block's design is fixed inside contentOnly, naming the block", () => {
    const wording = lockRefusalWording({
      code: "locked-slot-content-only",
      holderType: "acme/hero",
      lock: "contentOnly",
      childType: "acme/headline",
    });
    expect(refusalAnnouncement(wording)).toBe(
      "This area of Hero is locked to its content. Headline's design and settings can't change here."
    );
  });
});

describe("repairStepSentence", () => {
  // The document a plan was made from, so each step's blocks are named by
  // their types there: a hero holding a card, and a headline beside it.
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "hero",
        type: "acme/hero",
        version: 1,
        props: {},
        slots: {
          body: [{ id: "card", type: "acme/card", version: 1, props: {} }],
        },
      },
    ],
  } as unknown as BlockDocument;

  it("says which block moves, out of whose area, and where to", () => {
    expect(
      repairStepSentence(
        {
          kind: "move",
          nodeId: "card",
          type: "acme/card",
          from: { holderId: "hero", slot: "body" },
          after: "hero",
        },
        document
      )
    ).toBe("Move Card out of Hero's locked area, to just after Hero.");
  });

  it("says which block is added, and to whose area", () => {
    expect(
      repairStepSentence(
        {
          kind: "add",
          nodeId: "new",
          type: "acme/headline",
          at: { holderId: "hero", slot: "body", index: 0 },
          nodeIds: ["new"],
        },
        document
      )
    ).toBe("Add the Headline that Hero's locked area starts with.");
  });

  it("says whose area is put back in order", () => {
    expect(
      repairStepSentence(
        { kind: "reorder", holderId: "hero", slot: "body", order: ["card"] },
        document
      )
    ).toBe(
      "Put the blocks in Hero's locked area back in their starting order."
    );
  });

  it("says which block's design is put back, and what about it", () => {
    expect(
      repairStepSentence(
        {
          kind: "reset",
          nodeId: "card",
          type: "acme/card",
          parts: ['prop "align"', "styles"],
        },
        document
      )
    ).toBe('Put Card\'s design back as it started: prop "align", styles.');
  });
});
