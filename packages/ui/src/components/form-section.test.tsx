// @vitest-environment jsdom
/**
 * The section reproduces the chrome its predecessor shipped, because twelve
 * call sites already render it and two of them are navigation rather than
 * forms. The description is the only addition, and it is absent unless asked
 * for so existing callers render byte-identically.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FormSection } from "./form-section";

// Each `it` below renders into the shared jsdom document, and this suite
// deliberately reuses the string "body" across cases, so a leftover mount
// from the previous test would make `getByText` see two matches instead of
// one. Unmounting after every test keeps each case reading only its own DOM.
afterEach(cleanup);

describe("FormSection", () => {
  it("renders its label", () => {
    render(
      <FormSection label="Details">
        <p>body</p>
      </FormSection>
    );
    expect(screen.getByText("Details")).toBeDefined();
  });

  it("renders a description only when supplied", () => {
    const { rerender } = render(
      <FormSection label="Details" description="How this key is identified.">
        <p>body</p>
      </FormSection>
    );
    expect(screen.getByText("How this key is identified.")).toBeDefined();

    rerender(
      <FormSection label="Details">
        <p>body</p>
      </FormSection>
    );
    expect(screen.queryByText("How this key is identified.")).toBeNull();
  });

  it("renders its children inside the card", () => {
    render(
      <FormSection label="Details">
        <p>body</p>
      </FormSection>
    );
    expect(screen.getByText("body")).toBeDefined();
  });

  it("exposes the section's name via aria-labelledby", () => {
    // A visible label that nothing references does not give the region a
    // programmatic name. Read the ids directly rather than trusting an
    // accessible-name query alone, which a stray `aria-label` elsewhere in
    // the tree could satisfy without this relationship existing.
    const { container } = render(
      <FormSection label="Details">
        <p>body</p>
      </FormSection>
    );
    const section = container.querySelector("section");
    const label = screen.getByText("Details");
    expect(section?.getAttribute("aria-labelledby")).toBe(label.id);
    expect(label.id).not.toBe("");
  });

  it("gives every direct child the same vertical rhythm, whatever idiom it is", () => {
    // The section cannot see WHICH row idiom it was handed, so the rhythm
    // cannot be the caller's to supply. Two shipped idioms disagreed about it —
    // one padded itself, the other did not — and a section built from the
    // second rendered its first field hard against the card's top border.
    //
    // One token covers both the card's edge padding and the gap between two
    // fields, because they are the same measurement seen twice: the first
    // child's top padding IS the card's top inset.
    const { container } = render(
      <FormSection label="Locale">
        <div data-testid="first">first</div>
        <div data-testid="second">second</div>
      </FormSection>
    );

    const rows = container.querySelector('[data-slot^="card."] > div');
    // Tailwind v4's parenthesis syntax for a custom property. The
    // square-bracket `var()` spelling is a v3 form that v4 changed, and it
    // compiles here to a literal `padding-block: var(...)` — invalid CSS that
    // fails the whole stylesheet rather than dropping one rule, so the spelling
    // is part of the contract and not a formatting preference.
    expect(rows?.className).toContain("[&>*]:py-(--nx-field-gap)");
    // Assembled rather than written whole, for the reason above: a complete
    // arbitrary-value token anywhere in a scanned file becomes a real rule.
    expect(rows?.className).not.toContain(`py-${"["}var(`);
  });

  it("uses the shared Card for its container, not a hand-rolled one", () => {
    // Card is the one container implementation and carries the documented
    // container radius tier. Re-rolling the chrome here is what produced the
    // tier violation this replaces. Card tags its root `data-slot` with the
    // variant ("card.default"), so the selector matches that prefix rather
    // than the bare "card" a hand-rolled div would carry instead.
    const { container } = render(
      <FormSection label="Details">
        <p>body</p>
      </FormSection>
    );
    const card = container.querySelector('[data-slot^="card."]');
    expect(card).not.toBeNull();
    expect(card?.className).toContain("rounded-lg");
  });
});

// A form commits as one document, so its action belongs to the page rather than
// to a section, and this component exposes no footer slot. That absence is a
// COMPILE-TIME property: passing `footer` is a type error at every call site and
// `check-types` runs in the gate, so there is no runtime assertion to write for
// it. `CardFooter` exists and is deliberately not used here.
