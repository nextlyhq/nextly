/**
 * The two blocks that draw more than one element, and what their parts fix.
 *
 * Both defects were the same shape: an element the block renders inside its own
 * root carried no rule, so it kept whatever a user agent gave it. Asserted here
 * as the two halves that have to hold together — the block MARKS the element,
 * and the compiled sheet carries a rule for that mark. Either alone is inert:
 * a mark nothing styles changes nothing, and a rule for a mark nobody wears
 * reaches no element.
 *
 * @module blocks/adopted-parts.test
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { blockPartClassName, compilePageCss } from "@nextlyhq/blocks-engine";
import type { BlockDocument } from "@nextlyhq/blocks-engine";

import { form } from "./form";
import { image } from "./image";
import { quote } from "./quote";
import { blockBasesFor, blockPartsFor } from "../styles";
import { createBlockResolver } from "../resolver";

const blocks = createBlockResolver([form, image, quote] as never);

/** What a published page's stylesheet says, for a document using one block. */
function sheetFor(type: string): string {
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "n1", type, version: 1, props: {} }],
  } as unknown as BlockDocument;
  return compilePageCss(document, {
    breakpoints: { viewport: [{ id: "base", label: "Base" }], container: [] },
    // BOTH tiers, because a real page compiles both and the question here is
    // how they divide the work: the gap is the block's own, the field
    // separation is the part's. A sheet carrying one of them cannot answer it.
    blockBases: blockBasesFor(document, blocks),
    blockParts: blockPartsFor(document, blocks),
  } as never).css;
}

describe("core/quote, once it can style the quotation inside its figure", () => {
  const markup = (attribution: string) =>
    renderToStaticMarkup(
      quote.render({
        props: { text: "Words", attribution },
        node: { id: "n1", type: "core/quote", version: 1, props: {} },
        className: "nx-n1",
        partClass: (name: string) => blockPartClassName("core/quote", name),
        ctx: undefined,
        renderSlot: () => null,
      } as never) as never
    );

  it("marks the NESTED blockquote, which is the one that kept a UA margin", () => {
    expect(markup("Ada")).toContain(
      `<blockquote class="${blockPartClassName("core/quote", "quotation")}"`
    );
  });

  it("leaves the bare branch's blockquote wearing the block's own class", () => {
    // The same element is a root in one shape and a part in the other. Marking
    // it in both would apply the block's indent twice, which is the defect the
    // previous revision had and the reason this is asserted per branch.
    const bare = markup("");
    expect(bare).toContain('<blockquote class="nx-n1"');
    expect(bare).not.toContain(blockPartClassName("core/quote", "quotation"));
  });

  it("zeroes that blockquote's own margin in the compiled sheet", () => {
    // The measured defect: a user agent indents a `<blockquote>` about 40px,
    // and inside the figure that ADDED to the block's own padding — so the same
    // quote sat at 24px bare and 64px attributed. Typing an attribution moved
    // the text.
    const css = sheetFor("core/quote");
    expect(css).toContain(blockPartClassName("core/quote", "quotation"));
    // ALL FOUR sides, not the one the measurement happened to be about. A user
    // agent gives this element a margin on every side, the figure around it
    // already states the block ones, and a test naming a single side lets the
    // other three come back while staying green.
    for (const side of [
      "margin-block-start: 0",
      "margin-block-end: 0",
      "margin-inline-start: 0",
      "margin-inline-end: 0",
    ]) {
      expect(css).toContain(side);
    }
  });

  it("MARKS the attribution element", () => {
    // Asserted on the markup, separately from the sheet, because the two halves
    // fail independently: a rule for a mark nobody wears reaches no element,
    // and the stylesheet looks perfectly correct while it happens. Removing the
    // mark left every other assertion in this file green.
    expect(markup("Ada")).toContain(
      `<figcaption class="${blockPartClassName("core/quote", "attribution")}"`
    );
  });

  it("sets the attribution apart from the quotation it follows", () => {
    const css = sheetFor("core/quote");
    expect(css).toContain(blockPartClassName("core/quote", "attribution"));
    expect(css).toContain("font-size: 0.875em");
    // BOTH declarations, because the part states two things and a test naming
    // only one lets the other regress while staying green — the attribution
    // could run straight into the quotation above it and nothing would say so.
    expect(css).toContain("margin-block-start: 0.75em");
  });
});

describe("core/image, once it can style its caption", () => {
  it("MARKS the caption element", async () => {
    // Asserted separately from the sheet, because the two halves fail
    // independently: a rule for a mark nobody wears reaches no element, and the
    // stylesheet looks perfectly correct while it happens. Removing the mark
    // left every other assertion in this file green.
    const markup = renderToStaticMarkup(
      (await image.render({
        props: { src: "/a.jpg", alt: "", caption: "A view" },
        node: { id: "n1", type: "core/image", version: 1, props: {} },
        className: "nx-n1",
        partClass: (name: string) => blockPartClassName("core/image", name),
        ctx: { resolveMedia: () => Promise.resolve(null) },
        renderSlot: () => null,
      } as never)) as never
    );
    expect(markup).toContain(
      `<figcaption class="${blockPartClassName("core/image", "caption")}"`
    );
  });

  it("carries a rule for that mark in the compiled sheet", () => {
    // Unstyled, the caption drew at the body's own size directly beneath the
    // picture, so it read as another paragraph that happened to follow an image.
    const css = sheetFor("core/image");
    expect(css).toContain(blockPartClassName("core/image", "caption"));
    expect(css).toContain("font-size: 0.875em");
    // The part states smaller type AND a distance from the picture. Asserting
    // the size alone lets the caption regress to sitting flush against the
    // image while the test claiming to cover its presentation stays green.
    expect(css).toContain("margin-block-start: 0.5em");
  });

  it("does not style the IMG through the caption's rule", () => {
    // The part is a class the block marks one element with, so a sibling it
    // also renders cannot pick the rule up — which a `figure figcaption`
    // descendant could not have promised across a nested block.
    const css = sheetFor("core/image");
    expect(css).not.toContain("figcaption");
    expect(css).not.toContain(" img");
  });
});

describe("core/form, once it can space a control apart from its label", () => {
  it("marks each control, whichever element the field type renders", () => {
    // A field is an `<input>` or a `<textarea>` depending on its type, and both
    // are the same part: the thing a label names. Marking only one would leave
    // every textarea field ungrouped, which no assertion on the stylesheet
    // could see.
    const markup = renderToStaticMarkup(
      form.render({
        props: {
          fields: [
            { name: "a", label: "A", type: "text" },
            { name: "b", label: "B", type: "textarea" },
          ],
        },
        node: { id: "n1", type: "core/form", version: 1, props: {} },
        className: "nx-n1",
        partClass: (name: string) => blockPartClassName("core/form", name),
        ctx: undefined,
        renderSlot: () => null,
      } as never) as never
    );
    const marker = blockPartClassName("core/form", "control");
    expect(markup).toContain(`<input`);
    expect(markup).toContain(`<textarea`);
    expect(markup.split(marker).length - 1).toBe(2);
  });

  it("separates FIELDS with the control, not the grid gap", () => {
    // The measured defect: one even gap spaced a label as far from its own
    // input as from the next question, so nothing grouped. The gap is now the
    // label-to-control distance and the control states the field separation —
    // which is why the gap shrinks and a margin appears, rather than either
    // alone.
    const css = sheetFor("core/form");
    expect(css).toContain("gap: 0.25rem");
    expect(css).toContain(blockPartClassName("core/form", "control"));
    expect(css).toContain("margin-block-end: 0.75rem");
  });

  it("puts that distance BELOW the control, so the form has no leading gap", () => {
    // Above each label separates fields equally well and also pushes the FIRST
    // label down, which reads as padding nobody asked for. Asserted because the
    // two placements are indistinguishable from the field spacing alone.
    const css = sheetFor("core/form");
    expect(css).not.toContain("margin-block-start: 0.75rem");
  });
});
