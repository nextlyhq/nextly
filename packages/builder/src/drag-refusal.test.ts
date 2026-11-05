/**
 * Whether a refused drop tells the author something they can act on.
 *
 * Each case pins one property that separates an instruction from a "no": the
 * three refusal reasons imply three different remedies, so a sentence that is
 * right for one is wrong advice for another; and naming what the region DOES
 * take is the difference between a wall and a direction.
 *
 * Asserted on the exact strings rather than on a shape. Wording is the whole
 * deliverable here — a test that only checked a sentence was non-empty would
 * pass on every wrong sentence.
 *
 * @module drag-refusal.test
 */
import { describe, expect, it } from "vitest";

import { refusalWording } from "./drag-refusal";
import type { DropRefusal } from "./drop-targets";

const refusal = (
  reason: DropRefusal["reason"],
  permitted: readonly string[] = []
): DropRefusal => ({ regionId: "r1", reason, permitted });

describe("refusalWording", () => {
  it("names the block and the container for wrong-parent, in plain words", () => {
    const { headline } = refusalWording(
      refusal("wrong-parent"),
      "core/image",
      "core/accordion"
    );
    expect(headline).toBe("An Image can't go inside this Accordion.");
  });

  it("tells restricted-at-root to go inside something, not to aim elsewhere", () => {
    const { headline } = refusalWording(
      refusal("restricted-at-root"),
      "core/list-item",
      undefined
    );
    expect(headline).toBe("A List item has to go inside a container.");
    // The remedy for this reason is NOT "choose another container": at the root
    // there is no container on screen that would satisfy it, so that advice
    // cannot be followed. This assertion is what stops the three reasons being
    // collapsed into one sentence later.
    expect(headline).not.toContain("another");
  });

  it("names the spot rather than the parent for not-allowed-in-slot", () => {
    const { headline } = refusalWording(
      refusal("not-allowed-in-slot"),
      "core/image",
      "core/columns"
    );
    expect(headline).toBe("An Image can't go here.");
    expect(headline).not.toContain("Columns");
  });

  it("says what a SLOT admits, because that is what its list means", () => {
    // `canHoldInSlot` returns the slot's allow-list, so "This spot takes" is a
    // true statement about the region here and only here.
    const { remedy } = refusalWording(
      refusal("not-allowed-in-slot", ["core/heading", "core/paragraph"]),
      "core/image",
      "core/accordion"
    );
    expect(remedy).toBe("This spot takes a Heading or a Paragraph.");
  });

  it("does NOT claim the region accepts a moving block's valid parents", () => {
    /*
     * The separating case. For `wrong-parent`, `canNest` returns
     * `restrictionFor(childType)` — the containers the MOVING block may sit
     * inside — not anything the refusing region accepts. Wording it as "This
     * spot takes" would assert the accordion admits columns. Nothing measured
     * that.
     */
    const { remedy } = refusalWording(
      refusal("wrong-parent", ["core/columns"]),
      "core/column",
      "core/accordion"
    );
    expect(remedy).toBe("A Column goes inside a Columns.");
    expect(remedy).not.toContain("takes");
  });

  it("offers a parent list as alternatives to choose between", () => {
    const { remedy } = refusalWording(
      refusal("restricted-at-root", ["core/accordion", "core/columns"]),
      "core/accordion-item",
      undefined
    );
    expect(remedy).toBe(
      "An Accordion item goes inside an Accordion or a Columns."
    );
  });

  it("reads as prose for three or more admitted types", () => {
    const { remedy } = refusalWording(
      refusal("not-allowed-in-slot", [
        "core/heading",
        "core/paragraph",
        "core/list",
      ]),
      "core/image",
      "core/accordion"
    );
    expect(remedy).toBe("This spot takes a Heading, a Paragraph or a List.");
  });

  it("names a namespace wildcard as a group, not as a block called *", () => {
    // `nesting.ts` matches an allow entry ending "/*" as a prefix, so a slot
    // can admit a whole namespace. Humanising that as a block name yields the
    // bare "*", and the spot would announce "This spot takes *".
    const { remedy } = refusalWording(
      refusal("not-allowed-in-slot", ["core/*"]),
      "acme/widget",
      "core/columns"
    );
    expect(remedy).toBe("This spot takes any core block.");
    expect(remedy).not.toContain("*");
  });

  it("mixes a wildcard with named types in one list", () => {
    const { remedy } = refusalWording(
      refusal("not-allowed-in-slot", ["core/heading", "acme/*"]),
      "core/image",
      "core/columns"
    );
    expect(remedy).toBe("This spot takes a Heading or any acme block.");
  });

  it("omits the second line entirely when nothing is permitted", () => {
    // Rendering the lead-in with an empty list reads as a sentence that was cut
    // off, which is worse than saying nothing about the remedy at all.
    const { remedy } = refusalWording(
      refusal("wrong-parent", []),
      "core/image",
      "core/accordion"
    );
    expect(remedy).toBeNull();
  });

  it("chooses the article from the LABEL, not from the block type", () => {
    // "core/image" starts with a consonant and reads as "an Image". Deciding
    // from the type would produce "a Image" on every vowel-initial label.
    const { headline } = refusalWording(
      refusal("wrong-parent"),
      "core/accordion",
      "core/card"
    );
    expect(headline).toBe("An Accordion can't go inside this Card.");
  });

  it("still produces a sentence with an EMPTY block registry", () => {
    // The registry is empty at rest, and blockLabel humanises an unregistered
    // type rather than failing. A test that opened the editor first would pass
    // while a cold load rendered raw identities at the author.
    const { headline, remedy } = refusalWording(
      refusal("wrong-parent", ["acme/rich-text"]),
      "acme/hero-banner",
      "acme/tab-set"
    );
    expect(headline).toBe("A Hero banner can't go inside this Tab set.");
    expect(remedy).toBe("A Hero banner goes inside a Rich text.");
  });

  it("does not name a container it was not given", () => {
    // wrong-parent normally knows its region, but the caller resolves that from
    // the document by id and can legitimately come up empty. The sentence must
    // degrade rather than render "…inside this undefined".
    const { headline } = refusalWording(
      refusal("wrong-parent"),
      "core/image",
      undefined
    );
    expect(headline).toBe("An Image can't go here.");
    expect(headline).not.toContain("undefined");
  });
});
