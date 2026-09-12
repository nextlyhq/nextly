/**
 * Whether the nesting rule refuses a move, and what it says when it does.
 *
 * This DECIDES — the store never asks the rule, so a null here is what lets a
 * move happen. That raises the stakes on both directions. A wrong refusal stops
 * an author doing something legal; a wrong permission lets the keyboard build a
 * document a drag would have refused, which is the defect this closes.
 *
 * The half most worth testing is still the NULL. Every case below that returns
 * one is a case where inventing a refusal would have been easy and wrong.
 *
 * Pure, so none of it needs a DOM.
 *
 * @module move-refusal.test
 */
import type {
  BlockDocument,
  ComponentDocument,
  ComponentLookup,
  NestingSource,
} from "@nextlyhq/blocks-engine";
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { refusalAnnouncement, nestingRefusalForMove } from "./move-refusal";

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
    const wording = nestingRefusalForMove(
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
    const wording = nestingRefusalForMove(
      documentOf(),
      "text",
      { parentId: "box", slot: "default", index: 0 },
      { parentsOf: () => ["acme/columns"] }
    );

    expect(wording?.headline).toMatch(/does not take/i);
    expect(wording?.headline).toContain("Box");
  });
});

it("refuses on the SLOT's allow-list, and names what the slot takes", () => {
  /*
   * The other half of the rule, and the half whose wording differs.
   *
   * `blockAllowedAt` asks two questions — the child saying where it makes
   * sense (`parentsOf`) and the container saying what it holds
   * (`slotAllowOf`) — and `drag-refusal` keeps their answers apart because
   * `permitted` is two different facts under one field name. A slot refusal
   * names what the SLOT admits; a parent refusal names the containers the
   * MOVING BLOCK may sit inside. Announcing one as the other tells an author
   * something about the region that was never measured.
   *
   * Without this the slot path is reachable in production and exercised by
   * nothing: every other case here goes through `parentsOf`.
   */
  const wording = nestingRefusalForMove(
    documentOf(),
    "text",
    { parentId: "box", slot: "header", index: 0 },
    {
      parentsOf: () => undefined,
      slotAllowOf: () => ["acme/heading"],
    }
  );

  expect(wording?.headline).toMatch(/this slot does not take/i);
  // "Takes" — a statement about the SLOT, which is true only for this reason.
  expect(wording?.remedy).toMatch(/^Takes /);
  expect(wording?.remedy).toContain("Heading");
});

describe("permitting, rather than inventing a refusal", () => {
  it("PERMITS a placement the rule allows, rather than refusing it", () => {
    /*
     * The store refuses for reasons nesting has no words for — a document at
     * its byte cap, a depth limit, an op the forest rejects. Reporting a
     * nesting cause there would send an author to change a container that was
     * never the problem, and they would have no way to discover that the
     * sentence was wrong.
     */
    expect(
      nestingRefusalForMove(documentOf(), "text", { index: 0 }, PERMISSIVE)
    ).toBeNull();
  });

  it("permits when the moving block is not in the document", () => {
    expect(
      nestingRefusalForMove(documentOf(), "gone", { index: 0 }, ONLY_IN_BOX)
    ).toBeNull();
  });

  it("permits when the destination parent is not in the document", () => {
    /*
     * A position naming a parent the document does not hold cannot be judged:
     * the rule needs the parent's TYPE, and guessing one would answer about a
     * container that is not there.
     */
    expect(
      nestingRefusalForMove(
        documentOf(),
        "text",
        { parentId: "gone", slot: "default", index: 0 },
        ONLY_IN_BOX
      )
    ).toBeNull();
  });
});

describe("a component instance is judged by the ROOTS of what it draws", () => {
  /*
   * An instance node's own type is not a registered block, so the nesting
   * source answers "no restriction" for it. Judged by that type, the keyboard
   * would move a component whose root belongs only inside a box up to the root
   * — the placement the pointer route refuses, because a drop is judged by
   * `placementTypesOf`. The keyboard asks the same question of the same
   * lookup, so the two routes cannot disagree about where an instance may go.
   */

  /** A rule keyed by TYPE: text lives only inside a box, everything else is free. */
  const TEXT_ONLY_IN_BOX: NestingSource = {
    parentsOf: type => (type === "acme/text" ? ["acme/box"] : undefined),
  };

  /** A definition whose one root is a text block. */
  const HEADER: ComponentDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [{ id: "d1", type: "acme/text", version: 1, props: {} }],
  };

  const DRAWS_HEADER: ComponentLookup = new Map([["header", HEADER]]);

  /** A page holding a box and an instance of the header, both at the root. */
  function pageOf(): BlockDocument {
    return {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "box",
          type: "acme/box",
          version: 1,
          props: {},
          slots: { children: [] },
        },
        {
          id: "inst",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: "header" },
        },
      ],
    };
  }

  it("refuses an instance at the root when the root it draws may only sit inside a box", () => {
    const wording = nestingRefusalForMove(
      pageOf(),
      "inst",
      { index: 0 },
      TEXT_ONLY_IN_BOX,
      DRAWS_HEADER
    );

    expect(wording?.headline).toMatch(/has to sit inside a container/i);
    expect(wording?.remedy).toContain("Box");
  });

  it("permits the same instance inside the box", () => {
    // The control: the lookup refuses the ROOT, not the instance as such.
    expect(
      nestingRefusalForMove(
        pageOf(),
        "inst",
        { parentId: "box", slot: "children", index: 0 },
        TEXT_ONLY_IN_BOX,
        DRAWS_HEADER
      )
    ).toBeNull();
  });

  it("judges an instance by its own type, which restricts nothing, when no lookup is given", () => {
    /*
     * A host without a definitions map — one whose library never loaded — has
     * nothing to resolve against, and the instance is drawn as a placeholder
     * wherever it sits. Refusing to move a placeholder would pin it to the
     * spot it was left in, so the answer is the one `placementTypesOf` gives
     * for an unresolvable instance: its own type.
     */
    expect(
      nestingRefusalForMove(pageOf(), "inst", { index: 0 }, TEXT_ONLY_IN_BOX)
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
