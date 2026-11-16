/**
 * One wording for every lock refusal, naming the area and what it still
 * allows. Each rule's remedy differs, so a wording that ignored the lock and
 * said one thing for all of them would fail here.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument } from "@nextlyhq/blocks-engine";

import { refusalAnnouncement } from "./move-refusal";
import {
  layersLockRefusalFor,
  lockRefusalWording,
  repairStepSentence,
} from "./lock-refusal";

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
          cause: "lock",
          nodeId: "card",
          type: "acme/card",
          from: { holderId: "hero", slot: "body" },
          after: "hero",
        },
        document
      )
    ).toBe("Move Card out of Hero's locked area, to just after Hero.");
  });

  it("says a block the placement rule moves isn't allowed where it was, not that it is locked", () => {
    expect(
      repairStepSentence(
        {
          kind: "move",
          cause: "placement",
          nodeId: "card",
          type: "acme/card",
          from: { holderId: "hero", slot: "body" },
          after: "hero",
        },
        document
      )
    ).toBe(
      "Move Card out of Hero, where it isn't allowed, to just after Hero."
    );
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

describe("a block locked in Layers, worded once for every surface", () => {
  const facts = (relation: "self" | "inside" | "around" | "destination") =>
    lockRefusalWording({
      code: "layers-locked",
      label: "Hero",
      relation,
      verb: "move",
    });

  it("says where the locked block sits relative to the one acted on", () => {
    expect(facts("self")).toEqual({
      headline: "Hero is locked.",
      remedy: "Unlock it to move it.",
    });
    expect(facts("inside")).toEqual({
      headline: "Hero inside this block is locked.",
      remedy: "Unlock Hero to move this block.",
    });
    expect(facts("around")).toEqual({
      headline: "This block is inside Hero, which is locked.",
      remedy: "Unlock Hero to move this block.",
    });
    expect(facts("destination")).toEqual({
      headline: "Hero is locked.",
      remedy: "Unlock it to add blocks to it.",
    });
  });

  it("says to save first for a lock the saved page still holds", () => {
    expect(
      refusalAnnouncement(
        lockRefusalWording({
          code: "layers-locked-when-saved",
          label: "Hero",
          relation: "inside",
          verb: "delete",
        })
      )
    ).toBe(
      "Save first: Hero is still locked on the saved page. Save, then delete it."
    );
  });
});

describe("layersLockRefusalFor", () => {
  const box = (id: string, extra: object = {}, children?: object[]) => ({
    id,
    type: "core/box",
    version: 1,
    props: {},
    ...(children === undefined ? {} : { slots: { children } }),
    ...extra,
  });
  const page = {
    formatVersion: 1,
    kind: "page",
    nodes: [box("hero", { locked: true }, [box("title")]), box("loose")],
  } as unknown as BlockDocument;

  it("answers an insert into the locked block as the place being locked", () => {
    expect(
      layersLockRefusalFor(page, [
        {
          kind: "insert",
          node: box("new") as never,
          at: { parentId: "title", slot: "children", index: 0 },
        },
      ])
    ).toEqual({
      code: "layers-locked",
      label: "Box",
      relation: "destination",
      verb: "add",
    });
  });

  it("finds a lock a LATER op of a group breaks, on the page the earlier ones leave", () => {
    expect(
      layersLockRefusalFor(page, [
        { kind: "update", id: "loose", patch: { name: "Moved" } },
        {
          kind: "move",
          id: "loose",
          to: { parentId: "hero", slot: "children", index: 0 },
        },
      ])
    ).toMatchObject({ relation: "destination" });
    expect(
      layersLockRefusalFor(page, [
        { kind: "update", id: "loose", patch: { name: "Free" } },
      ])
    ).toBeUndefined();
  });

  describe("moves of other blocks across a locked one, as the save reads them", () => {
    const row = (ids: string[]) =>
      ({
        formatVersion: 1,
        kind: "page",
        nodes: ids.map(id =>
          id === "hero" ? box("hero", { locked: true, name: "Hero" }) : box(id)
        ),
      }) as unknown as BlockDocument;
    const saved = row(["lead", "mid", "hero", "tail"]);

    it("allows one sibling moved across it, which the save accepts too", () => {
      expect(
        layersLockRefusalFor(
          saved,
          [{ kind: "move", id: "lead", to: { index: 3 } }],
          saved
        )
      ).toBeUndefined();
    });

    it("refuses moving several past it at once, which the save reads as the locked block moving", () => {
      expect(
        layersLockRefusalFor(
          saved,
          // To [hero, lead, mid, tail]: two blocks moved past it, where the
          // hero moving back would explain the page with one.
          [
            { kind: "move", id: "lead", to: { index: 2 } },
            { kind: "move", id: "mid", to: { index: 2 } },
          ],
          saved
        )
      ).toEqual({
        code: "layers-locked",
        label: "Hero",
        relation: "self",
        verb: "move",
      });
    });
  });
});
