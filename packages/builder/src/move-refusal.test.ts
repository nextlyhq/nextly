/**
 * What a refused move says, and when it admits it does not know.
 *
 * The half most worth testing is the SILENCE. A wrong sentence here sends an
 * author to fix a container that was never the problem, and the store refuses
 * for reasons — a byte cap, a depth limit — that nesting has no words for. So
 * every case below that returns `null` is a case where inventing a reason would
 * have been easy and wrong.
 *
 * Pure, so none of it needs a DOM.
 *
 * @module move-refusal.test
 */
import type { BlockDocument, NestingSource } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { refusalAnnouncement, refusedMoveWording } from "./move-refusal";

/** A page holding a text block and a box that could contain one. */
function documentOf(): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "text", type: "acme/text", version: 1, props: {} },
      { id: "box", type: "acme/box", version: 1, props: {} },
    ],
  } as BlockDocument;
}

/** A rule saying `acme/text` may only sit inside `acme/box`. */
const ONLY_IN_BOX: NestingSource = { parentsOf: () => ["acme/box"] };

/** A rule restricting nothing. */
const PERMISSIVE: NestingSource = { parentsOf: () => undefined };

describe("explaining a refused move", () => {
  it("names the reason and the remedy when the rule refuses the root", () => {
    const wording = refusedMoveWording(
      documentOf(),
      "text",
      { index: 0 },
      ONLY_IN_BOX
    );

    expect(wording?.headline).toMatch(/has to sit inside a container/i);
    expect(wording?.remedy).toMatch(/goes inside/i);
  });

  it("names the CONTAINER when the refusal is about a particular parent", () => {
    /*
     * The two reasons are not two spellings of one refusal: the root case says
     * "put it inside something" because no container on screen would take it,
     * and this one says "aim at a different container". An author given the
     * first sentence for the second case is told to do something they have
     * already done.
     */
    const wording = refusedMoveWording(
      documentOf(),
      "text",
      { parentId: "box", slot: "default", index: 0 },
      { parentsOf: () => ["acme/columns"] }
    );

    expect(wording?.headline).toMatch(/does not take/i);
    expect(wording?.headline).toContain("Box");
  });
});

describe("refusing to invent a reason", () => {
  it("says NOTHING when the nesting rule would have allowed the move", () => {
    /*
     * The store refuses for reasons nesting has no words for — a document at
     * its byte cap, a depth limit, an op the forest rejects. Reporting a
     * nesting cause there would send an author to change a container that was
     * never the problem, and they would have no way to discover that the
     * sentence was wrong.
     */
    expect(
      refusedMoveWording(documentOf(), "text", { index: 0 }, PERMISSIVE)
    ).toBeNull();
  });

  it("says nothing when the moving block is not in the document", () => {
    expect(
      refusedMoveWording(documentOf(), "gone", { index: 0 }, ONLY_IN_BOX)
    ).toBeNull();
  });

  it("says nothing when the destination parent is not in the document", () => {
    /*
     * A position naming a parent the document does not hold cannot be judged:
     * the rule needs the parent's TYPE, and guessing one would answer about a
     * container that is not there.
     */
    expect(
      refusedMoveWording(
        documentOf(),
        "text",
        { parentId: "gone", slot: "default", index: 0 },
        ONLY_IN_BOX
      )
    ).toBeNull();
  });
});

describe("the announced sentence", () => {
  it("joins the headline and the remedy", () => {
    expect(refusalAnnouncement({ headline: "No.", remedy: "Try a Box" })).toBe(
      "No. Try a Box"
    );
  });

  it("omits the remedy rather than trailing off when there is none", () => {
    /*
     * `remedy` is null when the engine named nothing permitted. Rendering it
     * anyway would end the sentence in a space or an empty clause, which reads
     * as a message that was cut off rather than one that had nothing to add.
     */
    expect(refusalAnnouncement({ headline: "No.", remedy: null })).toBe("No.");
  });
});
