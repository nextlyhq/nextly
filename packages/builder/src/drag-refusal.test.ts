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
  it("names the parent and the block for wrong-parent", () => {
    const { headline } = refusalWording(
      refusal("wrong-parent"),
      "core/image",
      "core/accordion"
    );
    expect(headline).toBe("Accordion does not take an Image.");
  });

  it("tells restricted-at-root to go inside something, not to aim elsewhere", () => {
    const { headline } = refusalWording(
      refusal("restricted-at-root"),
      "core/list-item",
      undefined
    );
    expect(headline).toBe("List item has to sit inside a container.");
    // The remedy for this reason is NOT "choose another container": at the root
    // there is no container on screen that would satisfy it, so that advice
    // cannot be followed. This assertion is what stops the three reasons being
    // collapsed into one sentence later.
    expect(headline).not.toContain("another");
  });

  it("names the slot rather than the parent for not-allowed-in-slot", () => {
    const { headline } = refusalWording(
      refusal("not-allowed-in-slot"),
      "core/image",
      "core/columns"
    );
    expect(headline).toBe("This slot does not take an Image.");
  });

  it("turns a refusal into an instruction by naming what is permitted", () => {
    const { takes } = refusalWording(
      refusal("wrong-parent", ["core/heading", "core/paragraph"]),
      "core/image",
      "core/accordion"
    );
    expect(takes).toBe("Takes Heading and Paragraph");
  });

  it("reads as prose for three or more permitted types", () => {
    const { takes } = refusalWording(
      refusal("wrong-parent", ["core/heading", "core/paragraph", "core/list"]),
      "core/image",
      "core/accordion"
    );
    expect(takes).toBe("Takes Heading, Paragraph and List");
  });

  it("omits the second line entirely when nothing is permitted", () => {
    // Rendering "Takes " with an empty list reads as a sentence that was cut
    // off, which is worse than saying nothing about what the region accepts.
    const { takes } = refusalWording(
      refusal("wrong-parent", []),
      "core/image",
      "core/accordion"
    );
    expect(takes).toBeNull();
  });

  it("chooses the article from the LABEL, not from the block type", () => {
    // "core/image" starts with a consonant and reads as "an Image". Deciding
    // from the type would produce "a Image" on every vowel-initial label.
    const { headline } = refusalWording(
      refusal("wrong-parent"),
      "core/accordion",
      "core/card"
    );
    expect(headline).toBe("Card does not take an Accordion.");
  });

  it("still produces a sentence with an EMPTY block registry", () => {
    // The registry is empty at rest, and blockLabel humanises an unregistered
    // type rather than failing. A test that opened the editor first would pass
    // while a cold load rendered raw identities at the author.
    const { headline, takes } = refusalWording(
      refusal("wrong-parent", ["acme/rich-text"]),
      "acme/hero-banner",
      "acme/tab-set"
    );
    expect(headline).toBe("Tab set does not take a Hero banner.");
    expect(takes).toBe("Takes Rich text");
  });

  it("does not name a container it was not given", () => {
    // wrong-parent normally knows its region, but the caller resolves that from
    // the document by id and can legitimately come up empty. The sentence must
    // degrade rather than render "undefined does not take…".
    const { headline } = refusalWording(
      refusal("wrong-parent"),
      "core/image",
      undefined
    );
    expect(headline).toBe("That container does not take an Image.");
    expect(headline).not.toContain("undefined");
  });
});
